//! Automatische lokale Sicherung (#119).
//!
//! Once a day the app packs every repertoire (`.pgn`, `.info` and the
//! import history `.history.json`, with their folders) and a consistent copy
//! of the training store into `<app data>/backups/jblbase-YYYY-MM-DD.zip`.
//! Saving by hand and the copy taken before a restore get the time as well
//! (`jblbase-YYYY-MM-DD-HHMMSS.zip`). The newest 7 backups are kept, and of
//! the older ones the newest of each week for 4 more weeks.
//!
//! The cloud sync passes mistakes on within seconds (a repertoire saved
//! broken is broken on every device); a backup can bring a single
//! repertoire back from an earlier day. Game databases and the position
//! store are not included: they are large and can be loaded or computed
//! again.

use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

use chrono::{Datelike, Local, NaiveDate};
use serde::Serialize;
use specta::Type;
use tauri::Manager;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::{error::Error, training::TrainingStore, AppState};

pub const BACKUP_DIR_NAME: &str = "backups";
const PREFIX: &str = "jblbase-";
const EXTENSION: &str = ".zip";
const REPERTOIRES: &str = "repertoires/";
const TRAINING_ENTRY: &str = "training.sqlite3";
/// Newest backups that are always kept.
const KEEP_RECENT: usize = 7;
/// Further weeks of which the newest backup is kept.
const KEEP_WEEKS: usize = 4;

#[derive(Serialize, Type, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    /// Absolute path of the ZIP file.
    pub file: String,
    /// Day of the backup, YYYY-MM-DD.
    pub date: String,
    /// Milliseconds since 1970 (file time).
    pub created_at: f64,
    pub size: f64,
    pub repertoires: u32,
}

#[derive(Serialize, Type, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupRepertoire {
    /// Path below the files folder, "/"-separated, without ".pgn".
    pub path: String,
    pub size: f64,
}

/// The day a backup file belongs to; `None` for any other file.
pub fn backup_date(file_name: &str) -> Option<NaiveDate> {
    let rest = file_name.strip_prefix(PREFIX)?.strip_suffix(EXTENSION)?;
    let day = rest.get(..10)?;
    let tail = &rest[10..];
    if !(tail.is_empty() || (tail.len() == 7 && tail.starts_with('-'))) {
        return None;
    }
    NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()
}

/// Which backups to remove. `names` are file names; the result keeps the
/// newest `KEEP_RECENT`, then the newest of each further week for
/// `KEEP_WEEKS` weeks.
pub fn backups_to_delete(names: &[String]) -> Vec<String> {
    let mut dated: Vec<(&String, NaiveDate)> = names
        .iter()
        .filter_map(|n| backup_date(n).map(|d| (n, d)))
        .collect();
    // Newest first; same day: the later time (longer name sorts after the
    // daily one, and HHMMSS sorts by time).
    dated.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(a.0)));
    let mut weeks = HashSet::new();
    let mut extra_weeks = 0;
    let mut delete = Vec::new();
    for (i, (name, date)) in dated.into_iter().enumerate() {
        if i < KEEP_RECENT {
            weeks.insert(date.iso_week());
            continue;
        }
        let week = date.iso_week();
        if extra_weeks < KEEP_WEEKS && weeks.insert(week) {
            extra_weeks += 1;
            continue;
        }
        delete.push(name.clone());
    }
    delete
}

/// Only plain relative paths ("a/b/c"), nothing that leaves the folder.
fn safe_relative(path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    if path.is_empty() || p.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(part) => out.push(part),
            _ => return None,
        }
    }
    Some(out)
}

fn is_repertoire(info: &Path) -> bool {
    fs::read_to_string(info)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .is_some_and(|v| v.get("type").and_then(|t| t.as_str()) == Some("repertoire"))
}

/// Relative paths (without ".pgn") of all repertoires below `dir`.
fn find_repertoires(dir: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(folder) = stack.pop() {
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let is_pgn = path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("pgn"));
            if !is_pgn || !is_repertoire(&path.with_extension("info")) {
                continue;
            }
            if let Ok(rel) = path.with_extension("").strip_prefix(dir) {
                let parts: Vec<String> = rel
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect();
                found.push(parts.join("/"));
            }
        }
    }
    found.sort();
    found
}

/// The files of one repertoire: (suffix in the ZIP, path on disk).
fn repertoire_files(base: &Path) -> [(&'static str, PathBuf); 3] {
    let with = |ext: &str| {
        let mut p = base.as_os_str().to_owned();
        p.push(ext);
        PathBuf::from(p)
    };
    [
        (".pgn", with(".pgn")),
        (".info", with(".info")),
        (".history.json", with(".history.json")),
    ]
}

fn file_millis(path: &Path) -> f64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// Writes a backup of `files_dir` (and the training store) to `target`.
pub fn write_backup(
    files_dir: &Path,
    target: &Path,
    training: Option<&TrainingStore>,
) -> Result<u32, Error> {
    let dir = target
        .parent()
        .ok_or_else(|| Error::Io(Box::new(std::io::Error::other("backup has no folder"))))?;
    fs::create_dir_all(dir)?;
    let partial = target.with_extension("zip.part");
    let training_copy = dir.join("training-backup.sqlite3.part");
    let result = (|| -> Result<u32, Error> {
        let mut zip = ZipWriter::new(fs::File::create(&partial)?);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut count = 0;
        for rel in find_repertoires(files_dir) {
            let base = files_dir.join(&rel);
            for (ext, path) in repertoire_files(&base) {
                let Ok(data) = fs::read(&path) else { continue };
                zip.start_file(format!("{REPERTOIRES}{rel}{ext}"), options)?;
                zip.write_all(&data)?;
            }
            count += 1;
        }
        if let Some(store) = training {
            let _ = fs::remove_file(&training_copy);
            if store.backup_to(&training_copy).is_ok() {
                zip.start_file(TRAINING_ENTRY, options)?;
                zip.write_all(&fs::read(&training_copy)?)?;
            }
        }
        zip.finish()?;
        Ok(count)
    })();
    let _ = fs::remove_file(&training_copy);
    match result {
        Ok(count) => {
            fs::rename(&partial, target)?;
            Ok(count)
        }
        Err(e) => {
            let _ = fs::remove_file(&partial);
            Err(e)
        }
    }
}

/// Removes old backups (see `backups_to_delete`).
pub fn prune_backups(dir: &Path) -> Result<(), Error> {
    let names: Vec<String> = fs::read_dir(dir)?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    for name in backups_to_delete(&names) {
        fs::remove_file(dir.join(name))?;
    }
    Ok(())
}

fn open_backup(file: &Path) -> Result<ZipArchive<fs::File>, Error> {
    Ok(ZipArchive::new(fs::File::open(file)?)?)
}

/// Repertoires in a backup.
pub fn read_backup_repertoires(file: &Path) -> Result<Vec<BackupRepertoire>, Error> {
    let mut zip = open_backup(file)?;
    let mut list = Vec::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i)?;
        let name = entry.name();
        if let Some(path) = name
            .strip_prefix(REPERTOIRES)
            .and_then(|n| n.strip_suffix(".pgn"))
        {
            list.push(BackupRepertoire {
                path: path.to_string(),
                size: entry.size() as f64,
            });
        }
    }
    list.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(list)
}

pub fn backup_info(file: &Path) -> Option<BackupInfo> {
    let name = file.file_name()?.to_string_lossy().into_owned();
    let date = backup_date(&name)?;
    let repertoires = read_backup_repertoires(file).ok()?.len() as u32;
    Some(BackupInfo {
        file: file.to_string_lossy().into_owned(),
        date: date.format("%Y-%m-%d").to_string(),
        created_at: file_millis(file),
        size: fs::metadata(file).map_or(0.0, |m| m.len() as f64),
        repertoires,
    })
}

/// All backups in `dir`, newest first.
pub fn list_backups(dir: &Path) -> Vec<BackupInfo> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut list: Vec<BackupInfo> = entries
        .flatten()
        .filter_map(|e| backup_info(&e.path()))
        .collect();
    list.sort_by(|a, b| b.created_at.total_cmp(&a.created_at));
    list
}

/// Writes the chosen repertoires of a backup back into `files_dir`
/// (replacing the current files). Returns the restored `.pgn` paths.
pub fn restore_repertoires(
    file: &Path,
    paths: &[String],
    files_dir: &Path,
) -> Result<Vec<String>, Error> {
    let mut zip = open_backup(file)?;
    let mut restored = Vec::new();
    for rel in paths {
        let Some(safe) = safe_relative(rel) else {
            continue;
        };
        let base = files_dir.join(&safe);
        let mut wrote_pgn = false;
        for (ext, target) in repertoire_files(&base) {
            let Ok(mut entry) = zip.by_name(&format!("{REPERTOIRES}{rel}{ext}")) else {
                continue;
            };
            let mut data = Vec::new();
            entry.read_to_end(&mut data)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&target, data)?;
            wrote_pgn |= ext == ".pgn";
        }
        if wrote_pgn {
            restored.push(base.with_extension("pgn").to_string_lossy().into_owned());
        }
    }
    Ok(restored)
}

fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, Error> {
    Ok(app.path().app_data_dir()?.join(BACKUP_DIR_NAME))
}

/// Makes a backup. `daily`: the automatic one, skipped when today's exists.
#[tauri::command]
#[specta::specta]
pub async fn backup_create(
    files_dir: String,
    daily: bool,
    app: tauri::AppHandle,
) -> Result<Option<BackupInfo>, Error> {
    let dir = backup_dir(&app)?;
    let now = Local::now();
    let day = now.format("%Y-%m-%d");
    let target = if daily {
        let t = dir.join(format!("{PREFIX}{day}{EXTENSION}"));
        if t.exists() {
            return Ok(None);
        }
        t
    } else {
        dir.join(format!("{PREFIX}{day}-{}{EXTENSION}", now.format("%H%M%S")))
    };
    let files_dir = PathBuf::from(files_dir);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        write_backup(&files_dir, &target, Some(&state.training))?;
        prune_backups(&dir)?;
        Ok::<_, Error>(backup_info(&target))
    })
    .await
    .map_err(|e| Error::Io(Box::new(std::io::Error::other(e.to_string()))))?
}

#[tauri::command]
#[specta::specta]
pub async fn backup_list(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, Error> {
    Ok(list_backups(&backup_dir(&app)?))
}

#[tauri::command]
#[specta::specta]
pub async fn backup_repertoires(file: String) -> Result<Vec<BackupRepertoire>, Error> {
    read_backup_repertoires(Path::new(&file))
}

#[tauri::command]
#[specta::specta]
pub async fn backup_restore(
    file: String,
    paths: Vec<String>,
    files_dir: String,
) -> Result<Vec<String>, Error> {
    restore_repertoires(Path::new(&file), &paths, Path::new(&files_dir))
}

#[tauri::command]
#[specta::specta]
pub async fn backup_folder(app: tauri::AppHandle) -> Result<String, Error> {
    let dir = backup_dir(&app)?;
    fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn reads_backup_names() {
        assert_eq!(
            backup_date("jblbase-2026-11-17.zip"),
            NaiveDate::from_ymd_opt(2026, 11, 17)
        );
        assert_eq!(
            backup_date("jblbase-2026-11-17-081500.zip"),
            NaiveDate::from_ymd_opt(2026, 11, 17)
        );
        assert_eq!(backup_date("jblbase-2026-11-17.zip.part"), None);
        assert_eq!(backup_date("notes.zip"), None);
        assert_eq!(backup_date("jblbase-2026-13-01.zip"), None);
    }

    #[test]
    fn keeps_seven_recent_and_one_per_week_for_four_weeks() {
        // Daily backups for 60 days up to 2026-11-17 (a Tuesday).
        let end = NaiveDate::from_ymd_opt(2026, 11, 17).unwrap();
        let all: Vec<String> = (0..60)
            .map(|i| {
                format!(
                    "jblbase-{}.zip",
                    (end - chrono::Duration::days(i)).format("%Y-%m-%d")
                )
            })
            .collect();
        let delete = backups_to_delete(&all);
        let kept: Vec<&String> = all.iter().filter(|n| !delete.contains(n)).collect();
        // 7 recent (11-11 … 11-17) cover two ISO weeks; then one per week for 4 weeks.
        assert_eq!(kept.len(), 11);
        assert!(kept.contains(&&"jblbase-2026-11-17.zip".to_string()));
        assert!(kept.contains(&&"jblbase-2026-11-11.zip".to_string()));
        // Newest of the next older weeks (Sundays).
        for day in ["2026-11-08", "2026-11-01", "2026-10-25", "2026-10-18"] {
            assert!(kept.contains(&&format!("jblbase-{day}.zip")), "{day}");
        }
        assert!(delete.contains(&"jblbase-2026-10-11.zip".to_string()));
    }

    #[test]
    fn few_backups_are_all_kept_and_other_files_ignored() {
        let list = names(&[
            "jblbase-2026-01-01.zip",
            "jblbase-2026-05-01.zip",
            "jblbase-2026-05-01-120000.zip",
            "readme.txt",
        ]);
        assert!(backups_to_delete(&list).is_empty());
    }

    #[test]
    fn rejects_paths_that_leave_the_folder() {
        assert!(safe_relative("Weiß/Italienisch").is_some());
        assert!(safe_relative("../x").is_none());
        assert!(safe_relative("/etc/x").is_none());
        assert!(safe_relative("a/../../x").is_none());
        assert!(safe_relative("").is_none());
    }

    #[test]
    fn backs_up_repertoires_only_and_restores_one() {
        let tmp = tempfile::tempdir().unwrap();
        let files = tmp.path().join("files");
        fs::create_dir_all(files.join("Weiß")).unwrap();
        fs::write(files.join("Weiß/Ital.pgn"), "1. e4 e5 *").unwrap();
        fs::write(
            files.join("Weiß/Ital.info"),
            r#"{"type":"repertoire","id":"r1"}"#,
        )
        .unwrap();
        fs::write(files.join("Weiß/Ital.history.json"), "[]").unwrap();
        fs::write(files.join("Partie.pgn"), "1. d4 *").unwrap();
        fs::write(files.join("Partie.info"), r#"{"type":"game"}"#).unwrap();
        fs::write(files.join("Alt.pgn.deleted-5"), "x").unwrap();

        let store = TrainingStore::open_in_memory();
        let target = tmp.path().join("backups/jblbase-2026-11-17.zip");
        assert_eq!(write_backup(&files, &target, Some(&store)).unwrap(), 1);

        let info = backup_info(&target).unwrap();
        assert_eq!(info.date, "2026-11-17");
        assert_eq!(info.repertoires, 1);
        let mut zip = open_backup(&target).unwrap();
        assert!(zip.by_name(TRAINING_ENTRY).is_ok());
        assert!(zip.by_name("repertoires/Partie.pgn").is_err());

        // Broken and then restored from the backup.
        fs::write(files.join("Weiß/Ital.pgn"), "kaputt").unwrap();
        let restored = restore_repertoires(&target, &["Weiß/Ital".to_string()], &files).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(
            fs::read_to_string(files.join("Weiß/Ital.pgn")).unwrap(),
            "1. e4 e5 *"
        );
        assert!(fs::read_to_string(files.join("Weiß/Ital.info"))
            .unwrap()
            .contains("r1"));

        // A deleted one comes back with its folder.
        fs::remove_dir_all(files.join("Weiß")).unwrap();
        restore_repertoires(&target, &["Weiß/Ital".to_string()], &files).unwrap();
        assert!(files.join("Weiß/Ital.history.json").exists());

        assert_eq!(list_backups(&tmp.path().join("backups")).len(), 1);
        assert!(!tmp
            .path()
            .join("backups/jblbase-2026-11-17.zip.part")
            .exists());
    }
}
