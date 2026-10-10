//! Preview HLS remux sessions.
//!
//! One preview = one session: the resolved CDN pair is remembered in the
//! [`crate::handlers::preview_stream`] store, ffmpeg reads both tracks
//! through the loopback relay (`/cdn/{token}/(video|audio)`) and writes
//! fMP4 HLS segments into a per-session temp dir that the `stream://`
//! protocol serves to the webview (`hls/{token}/…`).
//!
//! Why a relay instead of handing ffmpeg the CDN URLs: mid-stream URL
//! rotation (Bilibili's per-URL quota) is only possible on the Rust side;
//! ffmpeg cannot swap an input URL while running. See the spec
//! (docs/superpowers/specs/2026-10-10-preview-hls-remux-design.md).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command as AsyncCommand;

use crate::utils::ffmpeg_progress::parse_out_time;
use crate::utils::paths::get_ffmpeg_path;

/// Generation cap: how much of a video one preview session remuxes.
/// Bounds temp disk and CDN bytes on long videos; most previews close far
/// earlier. 1080p ≈ 340-500MB.
const PREVIEW_CAP_SECS: u32 = 900;

/// ffmpeg input read rate as a multiple of realtime. Keeps CDN load and
/// URL-rotation frequency bounded while far seeks catch up quickly
/// (a 5-minute-ahead seek lands in ~1 minute).
const PREVIEW_GENERATION_SPEED: u32 = 5;

/// Payload of `open_preview_session` (camelCase for the TS side).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSessionInfo {
    pub token: String,
    /// `stream://` path of the live-growing playlist.
    pub playlist: String,
    pub duration_sec: u64,
    /// min(duration, PREVIEW_CAP_SECS): where the playlist ends.
    pub capped_at_sec: u64,
}

/// Builds the ffmpeg argument list for one preview session.
///
/// - `-readrate N` paces generation (see [`PREVIEW_GENERATION_SPEED`]).
/// - `-reconnect*` makes ffmpeg retry the loopback URL when a mid-body
///   CDN death ends a stream early — the relay rotates the URL before the
///   retry lands (that composition is the quota survival mechanism).
///   Per-input AVOptions do NOT carry across `-i`, so the block repeats
///   before EVERY input; otherwise an audio-lane mid-body death would
///   abort the whole mux instead of getting the rotation re-GET.
/// - EVENT playlist + `append_list` grows the file as segments appear;
///   ffmpeg writes `#EXT-X-ENDLIST` at natural EOF (including the `-t`
///   cap), which tells hls.js generation finished. A mid-stream CDN
///   death can ALSO take this path (the input EOFs early and the demuxer
///   accepts it), so ENDLIST alone does not prove completion — the
///   supervisor's produced-length check reclassifies that case.
pub fn build_ffmpeg_args(
    video_url: &str,
    audio_url: Option<&str>,
    out_dir: &Path,
    cap_secs: u32,
    speed: u32,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-nostdin".into()];
    for input in std::iter::once(video_url).chain(audio_url) {
        args.extend([
            "-readrate".into(),
            speed.to_string(),
            // localhost reconnects: cheap, and the relay guarantees a
            // fresh URL after the rotation backoff window. Without the
            // http-error list ffmpeg aborts on the relay's 502/503
            // responses (HTTP errors are not reconnect-eligible by
            // default — measured), which would skip the rotation retry
            // the whole design relies on.
            "-reconnect".into(),
            "1".into(),
            "-reconnect_streamed".into(),
            "1".into(),
            "-reconnect_delay_max".into(),
            "5".into(),
            "-reconnect_on_http_error".into(),
            "502,503".into(),
            "-i".into(),
            input.to_string(),
        ]);
    }
    args.extend(["-map".into(), "0:v:0".into()]);
    if audio_url.is_some() {
        args.extend(["-map".into(), "1:a:0".into()]);
    }
    args.extend([
        "-c".into(),
        "copy".into(),
        "-f".into(),
        "hls".into(),
        "-hls_segment_type".into(),
        "fmp4".into(),
        "-hls_time".into(),
        "2".into(),
        "-hls_playlist_type".into(),
        "event".into(),
        "-hls_flags".into(),
        "independent_segments+append_list".into(),
        "-t".into(),
        cap_secs.to_string(),
        // The init segment MUST be pinned to the session dir: without
        // this, ffmpeg writes the default bare "init.mp4" to its CWD
        // while the playlist still references "init.mp4" relatively —
        // the webview's EXT-X-MAP fetch then 404s and hls.js dies with
        // fragLoadError (measured 2026-10-10; the spike had masked this
        // by running ffmpeg from the output parent directory).
        "-hls_fmp4_init_filename".into(),
        out_dir.join("init.mp4").to_string_lossy().into_owned(),
        "-hls_segment_filename".into(),
        out_dir.join("seg%03d.m4s").to_string_lossy().into_owned(),
        out_dir.join("playlist.m3u8").to_string_lossy().into_owned(),
    ]);
    args
}

/// One live preview session. Dropping `kill` (registry removal without an
/// explicit close) terminates ffmpeg via the supervisor's select arm.
struct Session {
    kill: tokio::sync::oneshot::Sender<()>,
    /// Supervisor completion signal: `close_session` waits on it so the
    /// dir removal never races the still-writing ffmpeg.
    done: tokio::sync::oneshot::Receiver<()>,
    dir: PathBuf,
    /// flock holder for `dir/session.lock` — the startup sweep's liveness
    /// probe (another app instance must not delete a live session's dir).
    _lock: std::fs::File,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Session>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock_sessions() -> std::sync::MutexGuard<'static, HashMap<String, Session>> {
    // Recover from poisoning (panic mid-lock) — a poisoned registry must
    // not kill every future preview.
    SESSIONS.lock().unwrap_or_else(|p| p.into_inner())
}

/// Root directory of all preview session dirs.
pub fn preview_root() -> PathBuf {
    std::env::temp_dir().join("bilibili-dl-preview")
}

/// Session dir of a live token (`None` when no session is registered).
pub fn session_dir(token: &str) -> Option<PathBuf> {
    lock_sessions().get(token).map(|s| s.dir.clone())
}

/// Opens a preview session: registers the CDN pair, starts ffmpeg against
/// the loopback relay, and returns the webview-facing playlist path.
///
/// `resolved` is `(video_url, audio_url, duration_sec)` — injected so
/// tests drive the session lifecycle without the BiliApi transport.
/// `loopback_base` is the relay base URL (tests pass a dummy; production
/// passes [`crate::handlers::preview_stream::ensure_loopback`]).
pub async fn open_session_with<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    ffmpeg_path: &Path,
    loopback_base: &str,
    bvid: &str,
    resolved: (String, Option<String>, u64),
) -> Result<PreviewSessionInfo, String> {
    let (video_url, audio_url, duration_sec) = resolved;
    if loopback_base.is_empty() {
        return Err("ERR::PREVIEW_RELAY_UNAVAILABLE".to_string());
    }
    if !ffmpeg_path.exists() {
        return Err("ERR::PREVIEW_FFMPEG_MISSING".to_string());
    }
    let video_path = crate::handlers::preview_stream::remember_preview_url(
        bvid,
        &video_url,
        audio_url.as_deref(),
    );
    let token = video_path.trim_start_matches("preview/").to_string();

    // Fresh dir per session; the flock marks it live for the sweep.
    let dir = preview_root().join(&token);
    std::fs::create_dir_all(&dir).map_err(|e| format!("ERR::PREVIEW_SESSION_DIR: {e}"))?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join("session.lock"))
        .and_then(|f| {
            fs2::FileExt::try_lock_exclusive(&f)?;
            Ok(f)
        })
        .map_err(|e| format!("ERR::PREVIEW_SESSION_LOCK: {e}"))?;

    // duration_seconds() reports 0 for a missing/unparseable view field;
    // ffmpeg with `-t 0` produces an EMPTY playlist, so a zero duration
    // falls back to the full cap and natural EOF ends generation instead.
    let capped_at_sec = if duration_sec == 0 {
        PREVIEW_CAP_SECS as u64
    } else {
        duration_sec.min(PREVIEW_CAP_SECS as u64)
    };
    let audio_arg = audio_url
        .as_deref()
        .map(|_| format!("{loopback_base}/cdn/{token}/audio"));
    let args = build_ffmpeg_args(
        &format!("{loopback_base}/cdn/{token}/video"),
        audio_arg.as_deref(),
        &dir,
        capped_at_sec as u32,
        PREVIEW_GENERATION_SPEED,
    );
    let mut cmd = AsyncCommand::new(ffmpeg_path);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("ERR::PREVIEW_FFMPEG_MISSING: spawn {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ERR::PREVIEW_FFMPEG_FAILED: no stderr".to_string())?;
    let (kill, killed) = tokio::sync::oneshot::channel::<()>();
    let (done_tx, done) = tokio::sync::oneshot::channel::<()>();
    let app_handle = app.clone();
    let progress_token = token.clone();
    // Expected playlist end for the supervisor's completeness check.
    // Unknown duration (0) is excluded: natural EOF anywhere before the
    // fallback cap is legitimate there and indistinguishable from a
    // mid-stream death.
    let exit_check = ExitCheck {
        playlist_path: dir.join("playlist.m3u8"),
        expected_sec: (duration_sec > 0).then_some(capped_at_sec),
    };
    // The supervisor OWNS the child: spawning it here and dropping the
    // handle at function exit would trigger kill_on_drop immediately.
    tauri::async_runtime::spawn(async move {
        supervise_ffmpeg(
            app_handle,
            progress_token,
            exit_check,
            child,
            stderr,
            killed,
            done_tx,
        )
        .await;
    });

    lock_sessions().insert(
        token.clone(),
        Session {
            kill,
            done,
            dir: dir.clone(),
            _lock: lock,
        },
    );
    log::info!(
        "[BE] preview_hls: session opened token={token} bvid={bvid} capped_at={capped_at_sec}s"
    );
    Ok(PreviewSessionInfo {
        token: token.clone(),
        playlist: format!("hls/{token}/playlist.m3u8"),
        duration_sec,
        capped_at_sec,
    })
}

/// Slack for the clean-exit completeness check: HLS segments cut on input
/// keyframes (bilibili streams keyframe every ~5s; `-hls_time 2` only
/// sets the minimum), so a genuinely finished playlist can end a few
/// seconds short of the expected total.
const PREMATURE_TOLERANCE_SECS: f64 = 8.0;

/// Inputs for the supervisor's clean-exit completeness check (bundled to
/// keep the supervisor's signature sane).
struct ExitCheck {
    playlist_path: PathBuf,
    /// Expected playlist end; `None` for unknown durations, where a
    /// natural EOF before the fallback cap is legitimate.
    expected_sec: Option<u64>,
}

/// Sum of a playlist's `#EXTINF` values — the media length actually
/// produced, which is the ground truth of what the webview can serve.
fn produced_secs(playlist: &str) -> f64 {
    playlist
        .lines()
        .filter_map(|line| line.trim().strip_prefix("#EXTINF:"))
        .filter_map(|v| v.trim().trim_end_matches(',').parse::<f64>().ok())
        .sum()
}

/// Owns the ffmpeg child for a session's whole lifetime: pumps `-progress`
/// stderr into `preview-hls-progress` events, kills the child when the
/// session closes, and emits `preview-hls-error` on a non-zero exit or a
/// premature clean one (see the exit arm).
async fn supervise_ffmpeg<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: String,
    exit_check: ExitCheck,
    mut child: tokio::process::Child,
    stderr: tokio::process::ChildStderr,
    killed: tokio::sync::oneshot::Receiver<()>,
    done: tokio::sync::oneshot::Sender<()>,
) {
    use tauri::Emitter;

    let reader = tokio::io::BufReader::new(stderr);
    let mut lines = reader.lines();
    let mut killed = killed;
    // Last stderr lines, kept as failure forensics: the exit status alone
    // was not diagnosable (a session died with a non-standard code and no
    // trace of WHY). Cheap: a few wrapped strings per session.
    let mut tail: std::collections::VecDeque<String> =
        std::collections::VecDeque::with_capacity(30);
    loop {
        tokio::select! {
            // Kill first: when a close races a natural exit, both arms can
            // be ready and an unbiased select would report a spurious
            // "exited with <kill status>" + preview-hls-error for a
            // deliberate close.
            biased;
            _ = &mut killed => {
                // Session closed: reap the child before signalling done so
                // the dir removal never races file handles it still holds.
                let _ = child.kill().await;
                let _ = done.send(());
                return;
            },
            line = lines.next_line() => match line {
                Ok(Some(text)) => {
                    if !text.trim().is_empty() {
                        if tail.len() == 30 {
                            tail.pop_front();
                        }
                        tail.push_back(text.clone());
                    }
                    if let Some(current) = parse_out_time(&text) {
                        let payload = ProgressPayload {
                            token: token.clone(),
                            current_sec: current,
                        };
                        let _ = app.emit("preview-hls-progress", &payload);
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            },
        }
    }
    // stderr closed: ffmpeg exited on its own. Exit status is the only
    // reliable completion signal (`-progress` may not tick for very short
    // remuxes).
    match child.wait().await {
        Ok(status) if !status.success() => {
            log::warn!(
                "[BE] preview_hls: ffmpeg exited with {status}; stderr tail:\n{}",
                tail.into_iter().collect::<Vec<_>>().join("\n")
            );
            let _ = app.emit("preview-hls-error", &token);
        }
        Ok(_) => {
            // A clean exit does NOT imply a finished preview: when the
            // CDN dies mid-stream, the input EOFs early, ffmpeg finalizes
            // the EVENT playlist with #EXT-X-ENDLIST, and hls.js treats
            // the fragment as a complete VOD — the player freezes at the
            // last segment with no error UI (measured 2026-10-10, a 2h
            // video dying at 300s of 900s). Compare what the playlist
            // actually produced against the expected end and report a
            // shortfall as the failure it is.
            let premature = match exit_check.expected_sec {
                Some(expected) => {
                    let produced = tokio::fs::read_to_string(&exit_check.playlist_path)
                        .await
                        .map(|p| produced_secs(&p))
                        .unwrap_or(0.0);
                    if produced + PREMATURE_TOLERANCE_SECS < expected as f64 {
                        log::warn!(
                            "[BE] preview_hls: ffmpeg exited cleanly but produced {produced:.1}s of {expected}s — treating as failure (mid-stream CDN death)"
                        );
                        true
                    } else {
                        false
                    }
                }
                None => false,
            };
            if premature {
                let _ = app.emit("preview-hls-error", &token);
            } else {
                let _ = app.emit("preview-hls-completed", &token);
            }
        }
        Err(e) => {
            log::warn!("[BE] preview_hls: ffmpeg wait failed: {e}");
            let _ = app.emit("preview-hls-error", &token);
        }
    }
    let _ = done.send(());
}

/// `preview-hls-progress` payload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub token: String,
    pub current_sec: f64,
}

/// Closes a preview session: kills ffmpeg, waits for the supervisor to
/// reap it, then removes the session dir. Safe to call twice (second call
/// is a no-op).
pub async fn close_session(token: &str) {
    let session = lock_sessions().remove(token);
    if let Some(session) = session {
        // Ignore send errors: a supervisor that already exited (natural
        // completion) dropped the receiver — nothing left to kill.
        let _ = session.kill.send(());
        let _ = tokio::time::timeout(Duration::from_secs(5), session.done).await;
        if let Err(e) = tokio::fs::remove_dir_all(&session.dir).await {
            log::warn!(
                "[BE] preview_hls: failed to remove session dir {}: {e}",
                session.dir.display()
            );
        }
    }
}

/// Command implementation for opening a session: resolves the CDN pair +
/// duration, ensures the loopback relay, delegates to [`open_session_with`].
pub async fn open_preview_session_impl(
    app: &tauri::AppHandle,
    bvid: &str,
) -> Result<PreviewSessionInfo, String> {
    let resolved = crate::handlers::bilibili::resolve_preview_streams_for_hls(app, bvid).await?;
    let base = crate::handlers::preview_stream::ensure_loopback(app);
    open_session_with(
        app,
        &get_ffmpeg_path(app),
        &base,
        bvid,
        (resolved.0, resolved.1, resolved.2),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produced_secs_sums_extinf_values() {
        let playlist = "#EXTM3U\n#EXT-X-VERSION:7\n#EXTINF:5.000000,\nseg000.m4s\n#EXTINF:1.833313,\nseg001.m4s\n#EXT-X-ENDLIST\n";
        assert!((produced_secs(playlist) - 6.833313).abs() < 1e-6);
        assert_eq!(produced_secs("#EXTM3U\n"), 0.0);
    }

    #[test]
    fn build_ffmpeg_args_dash_two_inputs() {
        let args = build_ffmpeg_args(
            "http://127.0.0.1:1/cdn/t/video",
            Some("http://127.0.0.1:1/cdn/t/audio"),
            Path::new("/tmp/x"),
            900,
            5,
        );
        let j = args.join(" ");
        // The init segment must land inside the session dir (see the
        // build_ffmpeg_args comment); a bare name would fall back to
        // ffmpeg's CWD.
        let init_idx = args
            .iter()
            .position(|a| a == "-hls_fmp4_init_filename")
            .unwrap();
        assert!(
            args[init_idx + 1].ends_with("init.mp4")
                && args[init_idx + 1].contains(std::path::MAIN_SEPARATOR_STR),
            "args: {j}"
        );
        assert!(
            j.contains("-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5"),
            "args: {j}"
        );
        // Per-input options repeat for EVERY input (an audio-lane death
        // must reconnect too).
        assert_eq!(
            j.matches("-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5")
                .count(),
            2,
            "args: {j}"
        );
        assert_eq!(
            j.matches("-reconnect_on_http_error 502,503").count(),
            2,
            "args: {j}"
        );
        assert_eq!(j.matches(" -i ").count(), 2, "args: {j}");
        assert_eq!(j.matches("-readrate 5").count(), 2, "args: {j}");
        assert!(j.contains("-map 0:v:0 -map 1:a:0"), "args: {j}");
        assert!(
            j.contains("-hls_segment_type fmp4 -hls_time 2"),
            "args: {j}"
        );
        assert!(j.contains("-hls_playlist_type event"), "args: {j}");
        assert!(
            j.contains("-hls_flags independent_segments+append_list"),
            "args: {j}"
        );
        assert!(j.contains("-t 900"), "args: {j}");
        assert!(j.ends_with("playlist.m3u8"), "args: {j}");
    }

    #[test]
    fn build_ffmpeg_args_durl_single_input() {
        let args = build_ffmpeg_args(
            "http://127.0.0.1:1/cdn/t/video",
            None,
            Path::new("/tmp/x"),
            900,
            5,
        );
        let j = args.join(" ");
        assert!(!j.contains("-map 1:a:0"), "args: {j}");
        assert_eq!(j.matches(" -i ").count(), 1, "args: {j}");
    }

    #[test]
    fn build_ffmpeg_args_uses_passed_cap() {
        let args = build_ffmpeg_args(
            "http://127.0.0.1:1/cdn/t/video",
            None,
            Path::new("/tmp/x"),
            120,
            5,
        );
        assert!(args.contains(&"-t".to_string()));
        let idx = args.iter().position(|a| a == "-t").unwrap();
        assert_eq!(args[idx + 1], "120");
    }

    #[test]
    fn build_ffmpeg_args_durl_has_single_reconnect_block() {
        let args = build_ffmpeg_args(
            "http://127.0.0.1:1/cdn/t/video",
            None,
            Path::new("/tmp/x"),
            900,
            5,
        );
        let j = args.join(" ");
        assert_eq!(
            j.matches("-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5")
                .count(),
            1,
            "args: {j}"
        );
    }

    #[tokio::test]
    async fn empty_loopback_base_maps_to_relay_unavailable() {
        // A failed loopback bind caches an empty base (see
        // preview_stream::ensure_loopback); the session must refuse before
        // spawning ffmpeg, whose only input lane is that relay. Checked
        // BEFORE the ffmpeg-exists probe (the path here does not exist).
        let app = tauri::test::mock_app();
        let err = open_session_with(
            app.handle(),
            Path::new("/nonexistent/ffmpeg"),
            "",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 60),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "ERR::PREVIEW_RELAY_UNAVAILABLE");
    }
}

/// Session-lifecycle tests against a fake ffmpeg executable. Unix-only,
/// matching the repo's tool-handler test convention (CI runs `cargo test`
/// on Ubuntu; `write_fake_ffmpeg_executor` in utils/ffmpeg_probe.rs is
/// `cfg(unix)` for the same reason).
#[cfg(all(test, unix))]
mod lifecycle_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn write_fake_ffmpeg(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("fake-ffmpeg");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[tokio::test]
    async fn open_creates_dir_lock_playlist_and_close_cleans_up() {
        let app = tauri::test::mock_app();
        let tmp = tempfile::tempdir().unwrap();
        // Writes the playlist to the last arg (the output path) and emits
        // one progress line, like ffmpeg finishing a tiny remux.
        let fake = write_fake_ffmpeg(
            tmp.path(),
            "printf 'out_time=00:00:01.000000\\n' 1>&2\nfor last do :; done\necho '#EXTM3U' > \"$last\"",
        );
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            (
                "http://cdn/v.m4s".into(),
                Some("http://cdn/a.m4s".into()),
                120,
            ),
        )
        .await
        .unwrap();
        assert_eq!(info.token.len(), 32);
        assert_eq!(info.playlist, format!("hls/{}/playlist.m3u8", info.token));
        assert_eq!(info.duration_sec, 120);
        assert_eq!(info.capped_at_sec, 120);
        let dir = session_dir(&info.token).unwrap();
        assert!(dir.join("session.lock").exists());
        // Give the fake a beat to finish writing, then close.
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(dir.join("playlist.m3u8").exists());
        // The stream:// route serves it with the HLS MIME for a live token.
        let served = crate::handlers::preview_stream::serve_hls_path(&format!(
            "{}/playlist.m3u8",
            info.token
        ))
        .await;
        assert_eq!(served.status(), tauri::http::StatusCode::OK);
        assert_eq!(
            served
                .headers()
                .get(tauri::http::header::CONTENT_TYPE)
                .unwrap(),
            "application/vnd.apple.mpegurl"
        );
        // Remaining whitelisted artifacts: the init segment and a written
        // media segment carry their own MIME types...
        std::fs::write(dir.join("init.mp4"), b"init").unwrap();
        std::fs::write(dir.join("seg000.m4s"), b"seg").unwrap();
        for (file, mime) in [
            ("init.mp4", "video/mp4"),
            ("seg000.m4s", "video/iso.segment"),
        ] {
            let artifact =
                crate::handlers::preview_stream::serve_hls_path(&format!("{}/{file}", info.token))
                    .await;
            assert_eq!(artifact.status(), tauri::http::StatusCode::OK);
            assert_eq!(
                artifact
                    .headers()
                    .get(tauri::http::header::CONTENT_TYPE)
                    .unwrap(),
                mime
            );
        }
        // A whitelisted-but-unwritten segment 404s (normal race).
        let missing =
            crate::handlers::preview_stream::serve_hls_path(&format!("{}/seg001.m4s", info.token))
                .await;
        assert_eq!(missing.status(), tauri::http::StatusCode::NOT_FOUND);
        close_session(&info.token).await;
        assert!(session_dir(&info.token).is_none());
        assert!(!dir.exists());
    }

    #[tokio::test]
    async fn playlist_route_long_polls_until_ffmpeg_writes_it() {
        // hls.js treats a manifest 404 as immediately fatal (4xx is
        // never retried) — the route must HOLD the request until the
        // real playlist appears instead of answering 404 (measured
        // 2026-10-10). The fake ffmpeg writes the playlist after ~1s,
        // imitating ffmpeg's first-segment warm-up.
        let app = tauri::test::mock_app();
        let tmp = tempfile::tempdir().unwrap();
        let fake = write_fake_ffmpeg(
            tmp.path(),
            "sleep 1\nfor last do :; done\necho '#EXTM3U' > \"$last\"",
        );
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 60),
        )
        .await
        .unwrap();
        let resp = crate::handlers::preview_stream::serve_hls_path(&format!(
            "{}/playlist.m3u8",
            info.token
        ))
        .await;
        assert_eq!(resp.status(), tauri::http::StatusCode::OK);
        let body = String::from_utf8(resp.body().clone()).unwrap();
        assert!(body.contains("#EXTM3U"), "body: {body}");
        close_session(&info.token).await;
    }
    #[tokio::test]
    async fn close_kills_a_sleeping_ffmpeg_and_removes_dir() {
        let app = tauri::test::mock_app();
        let tmp = tempfile::tempdir().unwrap();
        let fake = write_fake_ffmpeg(tmp.path(), "sleep 30");
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 60),
        )
        .await
        .unwrap();
        let dir = session_dir(&info.token).unwrap();
        close_session(&info.token).await;
        assert!(!dir.exists());
    }

    #[tokio::test]
    async fn cap_uses_min_of_duration_and_limit() {
        let app = tauri::test::mock_app();
        let tmp = tempfile::tempdir().unwrap();
        let fake = write_fake_ffmpeg(tmp.path(), "exit 0");
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 5000),
        )
        .await
        .unwrap();
        assert_eq!(info.duration_sec, 5000);
        assert_eq!(info.capped_at_sec, 900);
        close_session(&info.token).await;
    }

    #[tokio::test]
    async fn zero_duration_falls_back_to_full_cap() {
        // The view API sometimes omits duration; `-t 0` would produce an
        // empty playlist, so the session must cap at the full limit.
        let app = tauri::test::mock_app();
        let tmp = tempfile::tempdir().unwrap();
        let fake = write_fake_ffmpeg(tmp.path(), "exit 0");
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 0),
        )
        .await
        .unwrap();
        assert_eq!(info.duration_sec, 0);
        assert_eq!(info.capped_at_sec, 900);
        close_session(&info.token).await;
    }

    #[tokio::test]
    async fn missing_ffmpeg_maps_to_error() {
        let app = tauri::test::mock_app();
        let err = open_session_with(
            app.handle(),
            Path::new("/nonexistent/ffmpeg"),
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 60),
        )
        .await
        .unwrap_err();
        assert_eq!(err, "ERR::PREVIEW_FFMPEG_MISSING");
    }

    #[tokio::test]
    async fn startup_sweep_deletes_only_unlocked_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let live = tmp.path().join("live-token");
        let orphan = tmp.path().join("orphan-token");
        std::fs::create_dir_all(&live).unwrap();
        std::fs::create_dir_all(&orphan).unwrap();
        // Live session: flock held on session.lock.
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(live.join("session.lock"))
            .unwrap();
        fs2::FileExt::try_lock_exclusive(&lock).unwrap();
        // Crashed session: lock file exists but is free.
        std::fs::write(orphan.join("session.lock"), b"x").unwrap();
        let deleted = crate::handlers::cleanup::cleanup_preview_dirs_in_dir(tmp.path());
        assert_eq!(deleted, 1);
        assert!(live.exists());
        assert!(!orphan.exists());
    }

    #[tokio::test]
    async fn close_session_is_idempotent_and_ignores_unknown_tokens() {
        let app = tauri::test::mock_app();
        let tmp = tempfile::tempdir().unwrap();
        let fake = write_fake_ffmpeg(tmp.path(), "sleep 30");
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 60),
        )
        .await
        .unwrap();
        let dir = session_dir(&info.token).unwrap();
        close_session(&info.token).await;
        assert!(!dir.exists());
        // Dialog unmount racing an entry switch can close the same session
        // twice; the registry entry is already gone, so the second call
        // must neither panic nor touch anything.
        close_session(&info.token).await;
        assert!(session_dir(&info.token).is_none());
        // A token the backend never issued is equally harmless.
        close_session("00112233445566778899aabbccddeeff").await;
    }

    #[tokio::test]
    async fn supervisor_reports_progress_then_error_on_nonzero_exit() {
        use tauri::Listener as _;
        let app = tauri::test::mock_app();
        // The dialog's retry logic hangs off exactly these three events
        // (VideoPreviewDialog.tsx): a parsed `-progress` tick and either a
        // natural completion or a fatal exit.
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, String)>();
        for name in [
            "preview-hls-progress",
            "preview-hls-completed",
            "preview-hls-error",
        ] {
            let tx = tx.clone();
            let name = name.to_string();
            app.listen(name.clone(), move |event| {
                let _ = tx.send((name.clone(), event.payload().to_string()));
            });
        }
        let tmp = tempfile::tempdir().unwrap();
        // One progress tick, then a fatal exit (CDN death / rotation
        // exhaustion upstream of ffmpeg).
        let fake = write_fake_ffmpeg(
            tmp.path(),
            "printf 'out_time=00:00:02.000000\\n' 1>&2\nexit 3",
        );
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 60),
        )
        .await
        .unwrap();

        let progress = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("progress event arrives")
            .expect("event channel alive");
        assert_eq!(progress.0, "preview-hls-progress");
        assert_eq!(
            progress.1,
            format!(r#"{{"token":"{}","currentSec":2.0}}"#, info.token)
        );

        let failure = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("error event arrives")
            .expect("event channel alive");
        assert_eq!(failure.0, "preview-hls-error");
        assert_eq!(failure.1, format!("\"{}\"", info.token));

        // A failed exit must not also claim completion — the FE would then
        // clear the "generating" badge for a playlist that stopped growing.
        assert!(rx.try_recv().is_err(), "no completion after a failed exit");
        close_session(&info.token).await;
    }

    #[tokio::test]
    async fn supervisor_reports_completion_on_clean_exit() {
        use tauri::Listener as _;
        let app = tauri::test::mock_app();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, String)>();
        for name in ["preview-hls-completed", "preview-hls-error"] {
            let tx = tx.clone();
            let name = name.to_string();
            app.listen(name.clone(), move |event| {
                let _ = tx.send((name.clone(), event.payload().to_string()));
            });
        }
        let tmp = tempfile::tempdir().unwrap();
        // Natural EOF (the `-t` cap or the end of a short video): exit 0
        // with a playlist covering the full expected 60s.
        let fake = write_fake_ffmpeg(
            tmp.path(),
            "for last do :; done\nprintf '#EXTM3U\\n#EXTINF:60.0,\\nseg000.m4s\\n#EXT-X-ENDLIST\\n' > \"$last\"",
        );
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 60),
        )
        .await
        .unwrap();

        let done = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("completion event arrives")
            .expect("event channel alive");
        assert_eq!(done.0, "preview-hls-completed");
        assert_eq!(done.1, format!("\"{}\"", info.token));
        assert!(rx.try_recv().is_err(), "a clean exit is not an error");
        close_session(&info.token).await;
    }

    #[tokio::test]
    async fn supervisor_reports_premature_clean_exit_as_error() {
        use tauri::Listener as _;
        let app = tauri::test::mock_app();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, String)>();
        for name in ["preview-hls-completed", "preview-hls-error"] {
            let tx = tx.clone();
            let name = name.to_string();
            app.listen(name.clone(), move |event| {
                let _ = tx.send((name.clone(), event.payload().to_string()));
            });
        }
        let tmp = tempfile::tempdir().unwrap();
        // The measured mid-stream CDN death: ffmpeg swallows the early
        // input EOF as natural, finalizes the playlist with ENDLIST and
        // exits 0 — after producing only a fraction of the expected 60s.
        let fake = write_fake_ffmpeg(
            tmp.path(),
            "for last do :; done\nprintf '#EXTM3U\\n#EXTINF:10.0,\\nseg000.m4s\\n#EXT-X-ENDLIST\\n' > \"$last\"\nexit 0",
        );
        let info = open_session_with(
            app.handle(),
            &fake,
            "http://127.0.0.1:1",
            "BV1test",
            ("http://cdn/v.m4s".into(), None, 60),
        )
        .await
        .unwrap();

        let event = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("event arrives")
            .expect("event channel alive");
        assert_eq!(
            event.0, "preview-hls-error",
            "10s of 60s must not count as completion"
        );
        assert_eq!(event.1, format!("\"{}\"", info.token));
        assert!(rx.try_recv().is_err(), "premature exit is not completion");
        close_session(&info.token).await;
    }
}
