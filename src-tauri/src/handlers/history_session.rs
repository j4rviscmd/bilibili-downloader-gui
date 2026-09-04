//! Download history session lifecycle (issue #511).
//!
//! A download's history entry now spans the whole download lifetime instead
//! of appearing only on success:
//!
//! 1. **start**: an `in_progress` entry is inserted when the download begins,
//!    and an exclusive-flock lock file (`hist_{id}.lock` in the app data dir)
//!    is held for the download's lifetime.
//! 2. **settle**: the download's final `Result` rewrites the entry —
//!    `completed` on success, `failed` + the backend `ERR::*` code on error,
//!    removed entirely on user cancel.
//! 3. **crash**: a killed process skips settle, but the OS releases its flock,
//!    so the next launch's [`recover_interrupted`] detects "lock free ⇒ owner
//!    dead" (the same liveness rule as `cleanup::is_unlocked_orphan` and the
//!    `OutputReservation` dead-holder reclamation, issue #560) and marks the
//!    leftover `in_progress` entry `failed` with the pseudo code
//!    [`ERR_INTERRUPTED`].
//!
//! Multi-process safety: another app instance downloading in parallel holds
//! its session flock, so recovery and the startup cleanup never mistake a
//! live download for a crashed one.

use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

use fs2::FileExt;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::history::HistoryEntry;
use crate::store::HistoryStore;

/// Pseudo error code recorded when the owning process died before the
/// download result could settle the entry. The frontend maps it to a
/// translated message like any other `ERR::*` code.
pub const ERR_INTERRUPTED: &str = "ERR::INTERRUPTED";

/// Upper bound for the thumbnail API call during settle. The old code ran
/// this in a fire-and-forget spawn; settle now runs inline in
/// `download_video`, so without a cap an unreachable API would stall the
/// invoke even though the file itself is already complete.
const THUMBNAIL_FETCH_TIMEOUT_SECS: u64 = 10;

/// Outcome of a startup recovery pass.
#[derive(Debug, Default, serde::Serialize)]
pub struct RecoveryResult {
    /// in_progress entries marked `failed` (owner process was gone).
    pub marked_failed: usize,
    /// Orphaned session lock files deleted.
    pub locks_removed: usize,
}

/// Returns the session lock file path for a history entry id.
///
/// The id is frontend-supplied, so characters outside a filename-safe set
/// are replaced defensively.
fn session_lock_path(lock_dir: &Path, entry_id: &str) -> PathBuf {
    lock_dir.join(format!("hist_{}.lock", sanitize_entry_id(entry_id)))
}

/// Maps an entry id to filename-safe characters (`[A-Za-z0-9._-]` kept).
fn sanitize_entry_id(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// `hist_*.lock` files in the app data dir (session lock files only; the
/// locked_json `*.json.lock` files never match this prefix).
fn is_session_lock(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("hist_") && n.ends_with(".lock"))
}

/// Owns one download's in-progress history entry and its liveness lock.
///
/// The lock file is created and flocked *before* the entry is inserted, so
/// the invariant holds: an `in_progress` entry implies a lock file whose
/// flock is held by a live process. [`Drop`] is the safety net — if settle
/// never ran (panic path), the entry is recorded as interrupted instead of
/// staying `in_progress` forever, and the lock file is removed.
pub struct HistorySession {
    /// False when history tracking could not start (store/lock failure);
    /// every operation becomes a no-op so history never fails a download.
    enabled: bool,
    store: HistoryStore,
    lock_dir: PathBuf,
    entry_id: String,
    /// Holds the exclusive flock for the download's lifetime.
    lock: Option<File>,
    /// True once the entry reached a terminal state (or the session is
    /// disabled); guards against double-settle and the Drop fallback.
    finished: bool,
}

impl HistorySession {
    /// Starts tracking a download: acquires the session lock, then inserts
    /// the `in_progress` entry.
    ///
    /// Best-effort: any failure logs a warning and returns a disabled
    /// session (all no-ops) — a broken history store must not fail the
    /// download itself.
    pub fn start(app: &AppHandle, options: &crate::handlers::bilibili::DownloadOptions) -> Self {
        let store = match HistoryStore::new(app) {
            Ok(store) => store,
            Err(e) => {
                log::warn!("[BE] history_session: store unavailable: {e}");
                return Self::disabled();
            }
        };
        let lock_dir = match app.path().app_data_dir() {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("[BE] history_session: app data dir unavailable: {e}");
                return Self::disabled();
            }
        };
        match Self::start_with(store, lock_dir, initial_entry(options)) {
            Ok(session) => session,
            Err(e) => {
                log::warn!(
                    "[BE] history_session: start failed for {}: {e}",
                    options.download_id
                );
                Self::disabled()
            }
        }
    }

    /// Test seam: starts a session for an explicit entry without an AppHandle.
    fn start_with(
        store: HistoryStore,
        lock_dir: PathBuf,
        entry: HistoryEntry,
    ) -> Result<Self, String> {
        let lock_path = session_lock_path(&lock_dir, &entry.id);
        let lock = acquire_session_lock(&lock_path)?;
        if let Err(e) = store.add_entry(entry.clone()) {
            // Undo the lock so a failed insert cannot leave a live-looking
            // lock file behind (Drop would also clean it up, but the entry
            // was never inserted, so remove it here for clarity).
            drop(lock);
            let _ = fs::remove_file(&lock_path);
            return Err(e);
        }
        Ok(Self {
            enabled: true,
            store,
            lock_dir,
            entry_id: entry.id,
            lock: Some(lock),
            finished: false,
        })
    }

    /// A session whose operations are all no-ops.
    fn disabled() -> Self {
        Self {
            enabled: false,
            store: HistoryStore::with_path(PathBuf::new()),
            lock_dir: PathBuf::new(),
            entry_id: String::new(),
            lock: None,
            finished: true,
        }
    }

    /// Settles the entry from the download's final result: `completed`,
    /// `failed` (+ error code), or removed on cancel. Consumes `self`; the
    /// Drop implementation releases the lock and removes the lock file.
    pub async fn settle(
        mut self,
        app: &AppHandle,
        options: &crate::handlers::bilibili::DownloadOptions,
        result: &Result<String, String>,
    ) {
        // Note: both arms re-emit `history:entry_added` — no separate
        // "entry updated" event exists because the frontend never received the
        // in_progress entry (HistoryStore::get_all filters it out). The
        // reducer does not upsert (historySlice.addEntry just unshifts,
        // src/features/history/model/historySlice.ts), so this event must
        // fire at most once per entry id.
        match result {
            Ok(final_path) => {
                // Mirror the old save_to_history: use the part's thumbnail
                // when present, fetch the video's otherwise. The fetch is
                // time-boxed because settle runs inline in download_video —
                // the invoke must not hang on an unreachable API after the
                // file is already complete (reqwest has no default total
                // timeout); a timed-out entry just lands without a thumbnail.
                let thumbnail_url = match options.thumbnail_url.clone() {
                    Some(url) => Some(url),
                    None => tokio::time::timeout(
                        std::time::Duration::from_secs(THUMBNAIL_FETCH_TIMEOUT_SECS),
                        fetch_thumbnail(app, &options.bvid),
                    )
                    .await
                    .ok()
                    .flatten(),
                };
                if let Some(entry) = self.complete(final_path, thumbnail_url) {
                    let _ = app.emit("history:entry_added", &entry);
                }
            }
            // Why: substring match, not equality — ERR::* codes travel inside
            // plain String messages that can carry extra text around the code
            // (the segment pipeline detects cancel with the same contains()
            // rule before propagating, utils/downloads.rs, issue #562).
            // Equality would record a user cancel as a `failed` history entry
            // instead of removing it.
            // User cancel is intent, not failure: leave no trace (issue #511).
            Err(e) if e.contains("ERR::CANCELLED") => self.cancel(),
            Err(e) => {
                if let Some(entry) = self.fail(e) {
                    let _ = app.emit("history:entry_added", &entry);
                }
            }
        }
    }

    /// Marks the entry `completed` with the final file size and thumbnail.
    /// Returns the updated entry, or `None` when there was nothing to settle.
    fn complete(
        &mut self,
        final_path: &str,
        thumbnail_url: Option<String>,
    ) -> Option<HistoryEntry> {
        let file_size = fs::metadata(final_path).ok().map(|m| m.len());
        self.finalize("complete", |e| {
            e.status = "completed".to_string();
            e.downloaded_at = now_rfc3339();
            e.file_size = file_size;
            if let Some(url) = &thumbnail_url {
                e.thumbnail_url = Some(url.clone());
            }
        })
    }

    /// Marks the entry `failed` with the backend error code.
    fn fail(&mut self, error_message: &str) -> Option<HistoryEntry> {
        self.finalize("fail", |e| {
            e.status = "failed".to_string();
            e.error_message = Some(error_message.to_string());
        })
    }

    /// Shared settle step: applies `f` to the entry, marks the session
    /// finished, and returns the updated entry — or `None` when disabled or
    /// there was nothing to settle.
    fn finalize(&mut self, step: &str, f: impl FnOnce(&mut HistoryEntry)) -> Option<HistoryEntry> {
        if !self.enabled {
            return None;
        }
        let result = self.store.update_in_progress(&self.entry_id, f);
        self.finished = true;
        match result {
            Ok(updated) => updated,
            Err(e) => {
                log::warn!(
                    "[BE] history_session: {step} update failed for {}: {e}",
                    self.entry_id
                );
                None
            }
        }
    }

    /// Removes the entry (user cancelled the download).
    fn cancel(&mut self) {
        if !self.enabled {
            return;
        }
        if let Err(e) = self.store.remove_entry(&self.entry_id) {
            log::warn!(
                "[BE] history_session: cancel removal failed for {}: {e}",
                self.entry_id
            );
        }
        self.finished = true;
    }
}

impl Drop for HistorySession {
    fn drop(&mut self) {
        // Panic path: settle never ran, so record the download as interrupted
        // instead of leaving an in_progress entry forever. No emit is possible
        // here (no AppHandle in Drop); the frontend sees the entry on its
        // next history load.
        if !self.finished && self.enabled {
            let _ = self.store.update_in_progress(&self.entry_id, |e| {
                e.status = "failed".to_string();
                e.error_message = Some(ERR_INTERRUPTED.to_string());
            });
        }
        // Release the flock before removing the file (required on Windows).
        self.lock = None;
        // Only an enabled session ever owned a lock file; a disabled one has
        // empty paths, and removing them would resolve to a relative
        // "hist_.lock" in the process CWD.
        if self.enabled {
            let _ = fs::remove_file(session_lock_path(&self.lock_dir, &self.entry_id));
        }
    }
}

/// Builds the initial `in_progress` entry for a download (id = download_id,
/// which is unique per download and doubles as the session lock name).
fn initial_entry(options: &crate::handlers::bilibili::DownloadOptions) -> HistoryEntry {
    let title = Path::new(&options.filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&options.filename)
        .to_string();
    let page_suffix = options.page.map(|p| format!("?p={p}")).unwrap_or_default();

    HistoryEntry {
        id: options.download_id.clone(),
        title,
        bvid: Some(options.bvid.clone()),
        url: format!(
            "https://www.bilibili.com/video/{}{}",
            options.bvid, page_suffix
        ),
        downloaded_at: now_rfc3339(),
        status: "in_progress".to_string(),
        error_message: None,
        file_size: None,
        quality: options
            .quality
            .as_ref()
            .map(crate::handlers::bilibili::quality_to_string),
        thumbnail_url: options.thumbnail_url.clone(),
        version: "1.0".to_string(),
    }
}

/// Current UTC time in the same compact RFC 3339 shape as the old
/// `save_to_history` used.
fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Fetches the video thumbnail for a completed entry (best-effort).
async fn fetch_thumbnail(app: &AppHandle, bvid: &str) -> Option<String> {
    let cookies = crate::handlers::cookie::read_cookie(app)
        .ok()
        .unwrap_or_default()
        .unwrap_or_default();
    crate::handlers::bilibili::fetch_video_info_for_history(bvid, &cookies)
        .await
        .and_then(|(_, url)| url)
}

/// Creates the session lock file and holds an exclusive flock on it.
///
/// Reclaims a dead holder first: an existing file whose flock can be taken
/// has no live owner (its process died; the OS released the lock), so it is
/// removed and re-created — the same rule as `try_claim` (issue #560).
fn acquire_session_lock(path: &Path) -> Result<File, String> {
    let try_create = || -> Result<File, std::io::Error> {
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .read(true)
            .open(path)?;
        file.lock_exclusive()?;
        Ok(file)
    };

    match try_create() {
        Ok(file) => Ok(file),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            // Dead-holder reclamation.
            if let Ok(existing) = OpenOptions::new().write(true).read(true).open(path) {
                if existing.try_lock_exclusive().is_ok() {
                    drop(existing);
                    let _ = fs::remove_file(path);
                }
            }
            try_create().map_err(|e| format!("cannot acquire session lock: {e}"))
        }
        Err(e) => Err(format!("cannot acquire session lock: {e}")),
    }
}

/// Startup recovery (issue #511): resolves the store and lock directory from
/// the app handle, then delegates to [`recover_interrupted_in`].
pub fn recover_interrupted(app: &AppHandle) -> RecoveryResult {
    let store = match HistoryStore::new(app) {
        Ok(store) => store,
        Err(e) => {
            log::warn!("[BE] history_session: store unavailable, skipping recovery: {e}");
            return RecoveryResult::default();
        }
    };
    let lock_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("[BE] history_session: app data dir unavailable: {e}");
            return RecoveryResult::default();
        }
    };
    recover_interrupted_in(&store, &lock_dir)
}

/// Directory-scoped core of [`recover_interrupted`] (test seam).
///
/// Pass 1 — settle orphaned entries: every `in_progress` entry whose lock
/// file is missing or whose flock can be taken (no live owner anywhere) is
/// marked `failed` with [`ERR_INTERRUPTED`]. An entry settled concurrently by
/// another process is skipped by the store's in-progress guard.
///
/// Pass 2 — sweep orphaned locks: every unlocked `hist_*.lock` is deleted,
/// covering both crash windows ("lock created but insert never happened" and
/// "entry settled but lock removal never happened"). Locks held by a live
/// download (another app instance included) are never touched.
pub fn recover_interrupted_in(store: &HistoryStore, lock_dir: &Path) -> RecoveryResult {
    let mut result = RecoveryResult::default();

    for entry in store.load().unwrap_or_default() {
        if entry.status != "in_progress" {
            continue;
        }
        let lock_path = session_lock_path(lock_dir, &entry.id);
        let owner_gone = !lock_path.exists() || is_unlocked(&lock_path);
        if owner_gone {
            match store.update_in_progress(&entry.id, |e| {
                e.status = "failed".to_string();
                e.error_message = Some(ERR_INTERRUPTED.to_string());
            }) {
                // Ok(None): another process settled it first — not ours.
                Ok(Some(_)) => result.marked_failed += 1,
                Ok(None) => {}
                Err(e) => log::warn!(
                    "[BE] history_session: recovery update failed for {}: {e}",
                    entry.id
                ),
            }
        }
    }

    if let Ok(entries) = fs::read_dir(lock_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if is_session_lock(&path) && is_unlocked(&path) && fs::remove_file(&path).is_ok() {
                result.locks_removed += 1;
            }
        }
    }

    if result.marked_failed > 0 || result.locks_removed > 0 {
        log::info!(
            "[BE] history_session: recovery marked {} interrupted download(s) failed, removed {} orphan lock file(s)",
            result.marked_failed,
            result.locks_removed
        );
    }
    result
}

/// True when no live process holds an exclusive flock on this file
/// (`cleanup::is_unlocked_orphan` rule). Best-effort: an unopenable file is
/// treated as locked (left alone).
fn is_unlocked(path: &Path) -> bool {
    match OpenOptions::new().write(true).read(true).open(path) {
        Ok(file) => file.try_lock_exclusive().is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_in(dir: &Path) -> HistoryStore {
        HistoryStore::with_path(dir.join("history.json"))
    }

    fn entry(id: &str, status: &str) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            title: format!("title-{id}"),
            bvid: Some(format!("BV{id}")),
            url: format!("https://www.bilibili.com/video/BV{id}"),
            downloaded_at: "2026-01-01T00:00:00+00:00".into(),
            status: status.into(),
            error_message: None,
            file_size: None,
            quality: None,
            thumbnail_url: None,
            version: "1.0".into(),
        }
    }

    #[test]
    fn session_lock_path_sanitizes_entry_id() {
        let path = session_lock_path(Path::new("/data"), "BV1ab-uuid4-p1");
        assert_eq!(path, Path::new("/data/hist_BV1ab-uuid4-p1.lock"));

        // Path separators and spaces from a hostile id are neutralized.
        let path = session_lock_path(Path::new("/data"), "a/b c:d");
        assert_eq!(path, Path::new("/data/hist_a_b_c_d.lock"));
    }

    #[test]
    fn is_session_lock_matches_only_hist_prefix() {
        assert!(is_session_lock(Path::new("hist_dl-1.lock")));
        // locked_json's store locks must not be swept as session locks.
        assert!(!is_session_lock(Path::new("history.json.lock")));
        assert!(!is_session_lock(Path::new("hist_video.part.mp4")));
    }

    #[test]
    fn start_with_inserts_in_progress_and_creates_lock() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());

        let session = HistorySession::start_with(
            store,
            dir.path().to_path_buf(),
            entry("dl-1", "in_progress"),
        )
        .unwrap();
        assert!(session_lock_path(dir.path(), "dl-1").exists());

        let entries = HistoryStore::with_path(dir.path().join("history.json"))
            .load()
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "dl-1");
        assert_eq!(entries[0].status, "in_progress");

        drop(session);
    }

    #[test]
    fn drop_without_settle_marks_interrupted_and_removes_lock() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());

        {
            let session = HistorySession::start_with(
                store,
                dir.path().to_path_buf(),
                entry("dl-1", "in_progress"),
            )
            .unwrap();
            drop(session); // simulate a panic before settle
        }

        let entries = store_in(dir.path()).load().unwrap();
        assert_eq!(entries[0].status, "failed");
        assert_eq!(entries[0].error_message.as_deref(), Some(ERR_INTERRUPTED));
        assert!(!session_lock_path(dir.path(), "dl-1").exists());
    }

    #[test]
    fn fail_marks_failed_with_error_code() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let mut session = HistorySession::start_with(
            store_in(dir.path()),
            dir.path().to_path_buf(),
            entry("dl-1", "in_progress"),
        )
        .unwrap();

        let updated = session.fail("ERR::NETWORK::2 segment(s) failed").unwrap();
        assert_eq!(updated.status, "failed");
        assert_eq!(
            updated.error_message.as_deref(),
            Some("ERR::NETWORK::2 segment(s) failed")
        );
        drop(session);

        let entries = store.load().unwrap();
        assert_eq!(entries[0].status, "failed");
        assert!(!session_lock_path(dir.path(), "dl-1").exists());
    }

    #[test]
    fn cancel_removes_entry() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let mut session = HistorySession::start_with(
            store_in(dir.path()),
            dir.path().to_path_buf(),
            entry("dl-1", "in_progress"),
        )
        .unwrap();

        session.cancel();
        drop(session);

        assert!(store.load().unwrap().is_empty());
        assert!(!session_lock_path(dir.path(), "dl-1").exists());
    }

    #[test]
    fn complete_finalizes_with_size_and_thumbnail() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("video.mp4");
        fs::write(&output, b"0123456789").unwrap();

        let mut session = HistorySession::start_with(
            store_in(dir.path()),
            dir.path().to_path_buf(),
            entry("dl-1", "in_progress"),
        )
        .unwrap();

        let updated = session
            .complete(
                &output.to_string_lossy(),
                Some("http://example.test/t.jpg".to_string()),
            )
            .unwrap();
        assert_eq!(updated.status, "completed");
        assert_eq!(updated.file_size, Some(10));
        assert_eq!(
            updated.thumbnail_url.as_deref(),
            Some("http://example.test/t.jpg")
        );
        drop(session);

        assert!(!session_lock_path(dir.path(), "dl-1").exists());
    }

    #[test]
    fn settle_after_clear_is_idempotent_noop() {
        // User cleared the history mid-download: finalize must not resurrect
        // the entry.
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        let mut session = HistorySession::start_with(
            store_in(dir.path()),
            dir.path().to_path_buf(),
            entry("dl-1", "in_progress"),
        )
        .unwrap();

        store.clear().unwrap();
        assert!(session.fail("ERR::NETWORK::x").is_none());
        assert!(store.load().unwrap().is_empty());
        drop(session);
    }

    #[test]
    fn disabled_session_is_all_noops() {
        let mut session = HistorySession::disabled();
        assert!(session.fail("ERR::X").is_none());
        session.cancel();
        assert!(session.complete("/nonexistent", None).is_none());
    }

    // ---- startup recovery ----

    #[test]
    fn recover_marks_unlocked_in_progress_failed() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        store.add_entry(entry("dl-1", "in_progress")).unwrap();
        fs::write(session_lock_path(dir.path(), "dl-1"), b"").unwrap(); // unlocked leftover

        let result = recover_interrupted_in(&store, dir.path());
        assert_eq!(result.marked_failed, 1);
        assert_eq!(result.locks_removed, 1);

        let entries = store.load().unwrap();
        assert_eq!(entries[0].status, "failed");
        assert_eq!(entries[0].error_message.as_deref(), Some(ERR_INTERRUPTED));
        assert!(!session_lock_path(dir.path(), "dl-1").exists());
    }

    #[test]
    fn recover_skips_entries_with_live_owner() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        store.add_entry(entry("dl-1", "in_progress")).unwrap();
        // Simulate another app instance mid-download: hold the flock.
        let holder = {
            let path = session_lock_path(dir.path(), "dl-1");
            let file = OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .read(true)
                .open(&path)
                .unwrap();
            file.lock_exclusive().unwrap();
            file
        };

        let result = recover_interrupted_in(&store, dir.path());
        assert_eq!(result.marked_failed, 0, "live download must not be touched");

        let entries = store.load().unwrap();
        assert_eq!(entries[0].status, "in_progress");
        drop(holder);
    }

    #[test]
    fn recover_marks_missing_lock_as_failed() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        store.add_entry(entry("dl-1", "in_progress")).unwrap();
        // No lock file at all (e.g. hand-deleted): no live owner can exist.

        let result = recover_interrupted_in(&store, dir.path());
        assert_eq!(result.marked_failed, 1);
        assert_eq!(store.load().unwrap()[0].status, "failed");
    }

    #[test]
    fn recover_sweeps_orphan_locks_without_entries() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_in(dir.path());
        // Crash window: lock created, insert never happened.
        fs::write(session_lock_path(dir.path(), "ghost"), b"").unwrap();
        // Crash window: entry settled, lock removal never happened.
        store.add_entry(entry("done-1", "completed")).unwrap();
        fs::write(session_lock_path(dir.path(), "done-1"), b"").unwrap();

        let result = recover_interrupted_in(&store, dir.path());
        assert_eq!(result.marked_failed, 0);
        assert_eq!(result.locks_removed, 2);
        assert_eq!(store.load().unwrap()[0].status, "completed");
    }
}
