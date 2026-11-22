//! Ein Profil pro Konto (1.2.13): Training, Statistik, Puzzle-Bewertung und
//! Sicherungen liegen je Konto in einem eigenen Ordner. Das Profil "legacy"
//! ist der bisherige Stand im App-Datenordner selbst, damit nichts umzieht.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::error::Error;
use crate::{insight, tactics, training, AppState};

pub const LEGACY: &str = "legacy";
const ACTIVE_FILE: &str = "active-profile";
const PROFILES_DIR: &str = "profiles";
const SNAPSHOT_FILE: &str = "local-storage.json";

/// "legacy", "guest" oder "u-" mit der Konto-Id (nur Buchstaben und Ziffern).
pub fn valid_key(key: &str) -> bool {
    if key == LEGACY || key == "guest" {
        return true;
    }
    match key.strip_prefix("u-") {
        Some(id) => {
            !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric())
        }
        None => false,
    }
}

pub fn data_dir_for(root: &Path, key: &str) -> PathBuf {
    if key == LEGACY {
        root.to_path_buf()
    } else {
        root.join(PROFILES_DIR).join(key)
    }
}

pub fn read_active(root: &Path) -> String {
    fs::read_to_string(root.join(ACTIVE_FILE))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|k| valid_key(k))
        .unwrap_or_else(|| LEGACY.to_string())
}

/// Ordner des aktiven Profils
pub fn active_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, Error> {
    let root = app.path().app_data_dir()?;
    Ok(data_dir_for(&root, &read_active(&root)))
}

/// Öffnet die Speicher des Profils (ersetzt die offenen)
pub fn open_stores(state: &AppState, dir: &Path) {
    if let Err(err) = fs::create_dir_all(dir) {
        log::warn!("Failed to create profile dir: {err}");
    }
    state.training.open(dir.join(training::TRAINING_FILE_NAME));
    state
        .insight
        .open(dir.join(insight::store::INSIGHT_FILE_NAME));
    state
        .rating
        .open(dir.join(tactics::calibration::RATING_FILE_NAME));
    state
        .reports
        .open(dir.join(tactics::review::REPORTS_FILE_NAME));
}

fn invalid(key: &str) -> Error {
    Error::Io(Box::new(std::io::Error::other(format!(
        "invalid profile {key}"
    ))))
}

/// Schlüssel des aktiven Profils
#[tauri::command]
#[specta::specta]
pub async fn active_profile(app: tauri::AppHandle) -> Result<String, Error> {
    Ok(read_active(&app.path().app_data_dir()?))
}

/// Wechselt das Profil: speichert `snapshot` (die Einstellungen der App) beim
/// bisherigen Profil, öffnet die Speicher des neuen und gibt dessen
/// gespeicherte Einstellungen zurück (None: neues Profil).
#[tauri::command]
#[specta::specta]
pub async fn switch_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    key: String,
    snapshot: String,
) -> Result<Option<String>, Error> {
    if !valid_key(&key) {
        return Err(invalid(&key));
    }
    let root = app.path().app_data_dir()?;
    let current = read_active(&root);
    let current_dir = data_dir_for(&root, &current);
    fs::create_dir_all(&current_dir)?;
    fs::write(current_dir.join(SNAPSHOT_FILE), snapshot)?;
    let target_dir = data_dir_for(&root, &key);
    fs::create_dir_all(&target_dir)?;
    let target = fs::read_to_string(target_dir.join(SNAPSHOT_FILE)).ok();
    fs::write(root.join(ACTIVE_FILE), &key)?;
    open_stores(&state, &target_dir);
    log::info!("Switched profile {current} -> {key}");
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys() {
        assert!(valid_key("legacy"));
        assert!(valid_key("guest"));
        assert!(valid_key("u-AbC123"));
        assert!(!valid_key("u-"));
        assert!(!valid_key("u-../x"));
        assert!(!valid_key("other"));
    }

    #[test]
    fn dirs_and_active() {
        let root = std::env::temp_dir().join(format!("jbl-profile-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        assert_eq!(data_dir_for(&root, "legacy"), root);
        assert_eq!(
            data_dir_for(&root, "u-x"),
            root.join("profiles").join("u-x")
        );
        assert_eq!(read_active(&root), "legacy");
        fs::write(root.join(ACTIVE_FILE), "u-x\n").unwrap();
        assert_eq!(read_active(&root), "u-x");
        fs::write(root.join(ACTIVE_FILE), "../evil").unwrap();
        assert_eq!(read_active(&root), "legacy");
        fs::remove_dir_all(&root).unwrap();
    }
}
