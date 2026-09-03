//! Application Settings Management
//!
//! This module handles reading and writing application settings to a JSON file,
//! including validation of download paths and fallback to system defaults.
//! Reads and writes go through the multi-process safe locked JSON helpers
//! (issue #560): atomic tmp+rename writes and inter-process locking, so two
//! app instances never corrupt each other's settings.
//!
//! Writes are FIELD PATCHES (issue #563), never whole-object replacements:
//! the caller sends only the fields it wants to change, and the merge runs
//! inside the lock against the latest on-disk state. A full-object save would
//! silently overwrite fields another app instance saved in the meantime.

use std::path::{Path, PathBuf};

use crate::{
    models::settings::Settings,
    utils::{locked_json, paths},
};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

/// Applies a partial settings update to the settings.json file.
///
/// The patch is a JSON object whose keys are settings field names
/// (camelCase, as serialized). Only the top-level keys present in the patch
/// are replaced; every other field keeps its latest on-disk value — fields
/// another app instance saved in the meantime are preserved (issue #563).
/// Unknown top-level keys on disk also survive the merge (they are dropped by
/// `Settings` (de)serialization otherwise, but the on-disk document keeps
/// them so hand-edited or forward-compatible entries are not destroyed).
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
/// * `patch` - JSON object with the settings fields to change
///
/// # Errors
///
/// Returns an error if:
/// - The patch is not a JSON object (`ERR:SETTINGS_PATCH_INVALID`)
/// - The merged document fails `Settings` validation (unknown/ill-typed fields)
/// - The patch changes `dlOutputPath` and the new path is invalid
///   (`ERR:SETTINGS_PATH_NOT_SET` / `ERR:SETTINGS_PATH_NOT_EXIST` /
///   `ERR::SETTINGS_PATH_NOT_DIRECTORY`)
/// - The locked read-merge-write fails
pub async fn patch_settings(app: &AppHandle, patch: Value) -> Result<(), String> {
    let filepath = paths::get_settings_path(app);
    patch_settings_at(&filepath, &patch)
}

/// Directory-scoped core of [`patch_settings`] (test seam).
///
/// Performs the locked shallow merge: read latest disk state, overlay the
/// patch keys, type-check the result as `Settings`, validate `dlOutputPath`
/// only when the patch touches it, then atomically write back.
fn patch_settings_at(filepath: &Path, patch: &Value) -> Result<(), String> {
    let patch_obj = patch
        .as_object()
        .ok_or_else(|| "ERR:SETTINGS_PATCH_INVALID".to_string())?;

    locked_json::with_json_mut(filepath, |value| {
        // Merge layers (later wins): Settings::default() < on-disk < patch.
        // Why the default layer: `language` is a required field (no serde
        // default), so a patch against a missing/empty file (first launch)
        // would otherwise fail "missing field language" for any single-field
        // save. The default layer guarantees required fields exist; disk and
        // patch layers override it wherever they carry a value.
        let mut merged: Map<String, Value> = match serde_json::to_value(Settings::default()) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        };
        // Shallow merge at the top level: existing keys not present in the
        // patch keep their on-disk values (this is the #563 guarantee —
        // another process's writes between our read and save are preserved).
        // Note: `take()` empties the in-memory document while the merged copy is
        // built. Safe only because with_json_mut writes back exclusively on Ok,
        // so a rejected patch leaves the file byte-for-byte untouched (see
        // utils/locked_json.rs and the ..._without_touching_file tests below).
        if let Value::Object(disk) = value.take() {
            for (key, val) in disk {
                merged.insert(key, val);
            }
        }
        for (key, val) in patch_obj {
            merged.insert(key.clone(), val.clone());
        }
        let merged_value = Value::Object(merged);

        // Type-check the merged document as Settings so an ill-typed patch
        // (e.g. `fontSize: "large"`) is rejected without touching the file.
        let merged_settings: Settings = serde_json::from_value(merged_value.clone())
            .map_err(|e| format!("ERR:SETTINGS_PATCH_INVALID: {}", e))?;

        // Validate dlOutputPath only when the patch changes it: re-validating
        // a pre-existing (possibly externally broken) value would block
        // unrelated saves, and the frontend patches it through the same path
        // validation flow as before.
        if patch_obj.contains_key("dlOutputPath") {
            let dl_output_path = merged_settings
                .dl_output_path
                .clone()
                .ok_or_else(|| "ERR:SETTINGS_PATH_NOT_SET".to_string())?;
            let dl_output_dir_path = PathBuf::from(dl_output_path);
            if !dl_output_dir_path.exists() {
                return Err("ERR:SETTINGS_PATH_NOT_EXIST".to_string());
            }
            if !dl_output_dir_path.is_dir() {
                return Err("ERR:SETTINGS_PATH_NOT_DIRECTORY".to_string());
            }
        }

        *value = merged_value;
        Ok(())
    })
    .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    Ok(())
}

/// Loads application settings from the settings.json file.
///
/// Falls back to the system's default download directory if no custom path
/// is configured. If the file doesn't exist or is corrupted, returns default
/// settings without creating the file (file is only created on writes).
///
/// # Arguments
///
/// * `app` - Tauri application handle for accessing application paths
///
/// # Returns
///
/// Returns the current application settings with defaults applied as needed.
/// Never fails - returns defaults on any error.
pub async fn get_settings(app: &AppHandle) -> Result<Settings, String> {
    let filepath = paths::get_settings_path(app);

    // Read settings under the inter-process lock; missing/empty/corrupt file
    // (corrupt files are quarantined by locked_json) all fall back to defaults
    // without creating the file (only writes create it).
    let settings: Settings = locked_json::with_json(&filepath, |value| {
        Ok(if value.as_object().is_some_and(|m| m.is_empty()) {
            Settings::default()
        } else {
            serde_json::from_value(value.clone()).unwrap_or_else(|e| {
                log::warn!(
                    "[BE] get_settings: failed to parse settings.json: {}. Using defaults.",
                    e
                );
                Settings::default()
            })
        })
    })
    .map_err(|e| format!("Failed to read settings.json: {}", e))?;

    // Apply default download directory if not set
    let settings = if settings
        .dl_output_path
        .as_ref()
        .is_none_or(|p| p.is_empty())
    {
        let default_path = app
            .path()
            .download_dir()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()));

        Settings {
            dl_output_path: default_path.or(settings.dl_output_path),
            ..settings
        }
    } else {
        settings
    };

    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings_file(dir: &Path) -> PathBuf {
        dir.join("settings.json")
    }

    fn write_settings(dir: &Path, value: Value) {
        std::fs::write(settings_file(dir), value.to_string()).unwrap();
    }

    fn read_settings(dir: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(settings_file(dir)).unwrap()).unwrap()
    }

    fn tempdir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn patch_updates_only_patched_fields() {
        let dir = tempdir();
        write_settings(
            dir.path(),
            json!({"dlOutputPath": "/tmp/a", "language": "en", "fontSize": 14}),
        );

        patch_settings_at(&settings_file(dir.path()), &json!({"fontSize": 18})).unwrap();

        let merged = read_settings(dir.path());
        assert_eq!(merged["fontSize"], json!(18), "patched field changes");
        assert_eq!(merged["language"], json!("en"), "untouched field survives");
        assert_eq!(merged["dlOutputPath"], json!("/tmp/a"));
    }

    #[test]
    fn patch_preserves_fields_written_by_another_process() {
        // The core #560/#563 guarantee: the stale-snapshot overwrite race is
        // structurally impossible because there is no snapshot — the merge
        // always reads the latest disk state inside the lock.
        let dir = tempdir();
        write_settings(
            dir.path(),
            json!({"language": "en", "downloadParallelism": 8}),
        );

        // "Another instance" writes between our read and our save; from the
        // patch's point of view it is simply the latest disk state.
        patch_settings_at(
            &settings_file(dir.path()),
            &json!({"downloadParallelism": 2}),
        )
        .unwrap();
        patch_settings_at(&settings_file(dir.path()), &json!({"language": "ja"})).unwrap();

        let merged = read_settings(dir.path());
        assert_eq!(merged["language"], json!("ja"));
        assert_eq!(merged["downloadParallelism"], json!(2), "no field lost");
    }

    #[test]
    fn patch_updates_lib_path_via_serde_rename_key() {
        // Pins the contract used by update_lib_path: it patches the
        // camelCase serde rename `libPath`. If the sent key ever diverges
        // from the rename, the patch silently no-ops (unknown keys are kept
        // on disk but ignored by Settings), so the library path would never
        // change.
        let dir = tempdir();
        write_settings(dir.path(), json!({"language": "en", "libPath": "/old/lib"}));

        patch_settings_at(&settings_file(dir.path()), &json!({"libPath": "/new/lib"})).unwrap();

        // On-disk document carries the renamed key...
        assert_eq!(read_settings(dir.path())["libPath"], json!("/new/lib"));
        // ...and the merged document still deserializes into Settings with
        // the field populated.
        let merged: Settings = serde_json::from_value(read_settings(dir.path())).unwrap();
        assert_eq!(merged.lib_path.as_deref(), Some("/new/lib"));
    }

    #[test]
    fn patch_on_missing_file_creates_it_with_patch_only() {
        let dir = tempdir();
        patch_settings_at(&settings_file(dir.path()), &json!({"fontSize": 16})).unwrap();

        let merged = read_settings(dir.path());
        assert_eq!(merged["fontSize"], json!(16));
    }

    #[test]
    fn patch_rejects_non_object() {
        let dir = tempdir();
        write_settings(dir.path(), json!({"language": "en"}));

        let err = patch_settings_at(&settings_file(dir.path()), &json!([1, 2])).unwrap_err();
        assert!(err.contains("ERR:SETTINGS_PATCH_INVALID"));
        // File untouched on rejection.
        assert_eq!(read_settings(dir.path())["language"], json!("en"));
    }

    #[test]
    fn patch_rejects_ill_typed_value_without_touching_file() {
        let dir = tempdir();
        write_settings(dir.path(), json!({"language": "en", "fontSize": 14}));

        let err = patch_settings_at(&settings_file(dir.path()), &json!({"fontSize": "large"}))
            .unwrap_err();
        assert!(err.contains("ERR:SETTINGS_PATCH_INVALID"), "got: {}", err);
        assert_eq!(
            read_settings(dir.path())["fontSize"],
            json!(14),
            "rejected patch must not write"
        );
    }

    #[test]
    fn patch_validates_dl_output_path_when_changed() {
        let dir = tempdir();
        write_settings(dir.path(), json!({"language": "en"}));

        let err = patch_settings_at(
            &settings_file(dir.path()),
            &json!({"dlOutputPath": "/definitely/not/a/dir"}),
        )
        .unwrap_err();
        assert!(err.contains("ERR:SETTINGS_PATH_NOT_EXIST"), "got: {}", err);
    }

    #[test]
    fn patch_skips_dl_output_path_validation_when_untouched() {
        // A pre-existing invalid path on disk must not block unrelated saves
        // (it was validated when it was set; blocking here would brick
        // every other setting toggle).
        let dir = tempdir();
        write_settings(
            dir.path(),
            json!({"dlOutputPath": "/no/longer/exists", "language": "en"}),
        );

        patch_settings_at(&settings_file(dir.path()), &json!({"fontSize": 20})).unwrap();
        assert_eq!(read_settings(dir.path())["fontSize"], json!(20));
    }

    #[test]
    fn patch_keeps_unknown_disk_keys() {
        // Hand-edited or forward-compatible keys on disk survive a patch;
        // they are invisible to `Settings` but not the on-disk document.
        let dir = tempdir();
        write_settings(
            dir.path(),
            json!({"language": "en", "futureField": {"nested": true}}),
        );

        patch_settings_at(&settings_file(dir.path()), &json!({"fontSize": 12})).unwrap();

        let merged = read_settings(dir.path());
        assert_eq!(merged["futureField"]["nested"], json!(true));
    }
}
