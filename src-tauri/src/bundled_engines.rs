//! Engines that ship with the installer (Stockfish and Patricia, see
//! scripts/prepare-engines.mjs). They sit read-only in the app's resources;
//! on start they are copied into the engines folder, where downloaded engines
//! live too, so an update of the app never pulls a running engine away.

use std::{
    fs,
    path::{Component, Path},
};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Manager;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use crate::error::Error;

/// Folder below the engines folder that holds the bundled engines.
const BUNDLED_DIR: &str = "bundled";
const MANIFEST: &str = "engines.json";

#[derive(Debug, Deserialize)]
struct ManifestEntry {
    id: String,
    name: String,
    version: String,
    /// Path of the program below the resources folder, e.g. "stockfish-19/stockfish".
    file: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct BundledEngine {
    pub id: String,
    pub name: String,
    pub version: String,
    /// Where the program lies after copying.
    pub path: String,
}

fn invalid(msg: String) -> Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, msg).into()
}

/// Only plain relative paths: nothing outside the resources folder.
fn is_plain_relative(path: &str) -> bool {
    let p = Path::new(path);
    !path.is_empty() && p.components().all(|c| matches!(c, Component::Normal(_)))
}

/// Copies a file unless the same size already lies there, through a
/// temporary file so a cut-off copy never looks finished.
fn copy_if_changed(from: &Path, to: &Path) -> Result<(), Error> {
    let size = fs::metadata(from)?.len();
    if fs::metadata(to).map(|m| m.len() == size).unwrap_or(false) {
        return Ok(());
    }
    let mut part = to.as_os_str().to_owned();
    part.push(".part");
    fs::copy(from, &part)?;
    fs::rename(&part, to)?;
    Ok(())
}

/// Copies every bundled engine (with its license files) from `resources`
/// into `engines_dir/bundled/` and returns where each program now lies.
/// Without a manifest (builds without bundled engines) there is nothing.
pub fn copy_bundled_engines(
    resources: &Path,
    engines_dir: &Path,
) -> Result<Vec<BundledEngine>, Error> {
    let manifest = resources.join(MANIFEST);
    if !manifest.exists() {
        return Ok(vec![]);
    }
    let entries: Vec<ManifestEntry> = serde_json::from_slice(&fs::read(&manifest)?)
        .map_err(|e| invalid(format!("{MANIFEST}: {e}")))?;
    let target_root = engines_dir.join(BUNDLED_DIR);
    let mut out = Vec::new();
    for entry in entries {
        if !is_plain_relative(&entry.file) {
            return Err(invalid(format!("{MANIFEST}: bad path {}", entry.file)));
        }
        let program = resources.join(&entry.file);
        if !program.is_file() {
            continue;
        }
        let src_dir = program.parent().unwrap_or(resources);
        let rel_dir = Path::new(&entry.file).parent().unwrap_or(Path::new(""));
        let dest_dir = target_root.join(rel_dir);
        fs::create_dir_all(&dest_dir)?;
        for file in fs::read_dir(src_dir)? {
            let file = file?;
            if file.file_type()?.is_file() {
                copy_if_changed(&file.path(), &dest_dir.join(file.file_name()))?;
            }
        }
        let dest = target_root.join(&entry.file);
        #[cfg(unix)]
        {
            let mut perms = fs::metadata(&dest)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&dest, perms)?;
        }
        out.push(BundledEngine {
            id: entry.id,
            name: entry.name,
            version: entry.version,
            path: dest.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn install_bundled_engines(
    app: tauri::AppHandle,
    engines_dir: String,
) -> Result<Vec<BundledEngine>, Error> {
    let resources = app
        .path()
        .resolve("engines", tauri::path::BaseDirectory::Resource)?;
    copy_bundled_engines(&resources, Path::new(&engines_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn nothing_without_manifest() {
        let res = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        assert!(copy_bundled_engines(res.path(), dest.path())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn copies_programs_and_license_files() {
        let res = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        write(&res.path().join("sf-19/stockfish"), b"engine");
        write(&res.path().join("sf-19/Copying.txt"), b"GPL");
        write(
            &res.path().join(MANIFEST),
            br#"[{"id":"sf-19","name":"Stockfish","version":"19","file":"sf-19/stockfish"},
                {"id":"gone","name":"Gone","version":"1","file":"gone/gone"}]"#,
        );
        let engines = copy_bundled_engines(res.path(), dest.path()).unwrap();
        assert_eq!(engines.len(), 1, "missing programs are skipped");
        let program = dest.path().join("bundled/sf-19/stockfish");
        assert_eq!(engines[0].path, program.to_string_lossy());
        assert_eq!(fs::read(&program).unwrap(), b"engine");
        assert_eq!(
            fs::read(dest.path().join("bundled/sf-19/Copying.txt")).unwrap(),
            b"GPL"
        );
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&program).unwrap().permissions().mode() & 0o777,
            0o755
        );

        // A second start copies nothing and gives the same answer.
        assert_eq!(
            copy_bundled_engines(res.path(), dest.path()).unwrap(),
            engines
        );
        // A changed program (new size) is copied again.
        write(&res.path().join("sf-19/stockfish"), b"engine v2");
        copy_bundled_engines(res.path(), dest.path()).unwrap();
        assert_eq!(fs::read(&program).unwrap(), b"engine v2");
    }

    #[test]
    fn refuses_paths_outside_the_resources() {
        let res = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        write(
            &res.path().join(MANIFEST),
            br#"[{"id":"x","name":"X","version":"1","file":"../x"}]"#,
        );
        assert!(copy_bundled_engines(res.path(), dest.path()).is_err());
    }
}
