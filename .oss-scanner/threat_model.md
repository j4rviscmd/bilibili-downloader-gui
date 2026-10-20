# Threat Model — bilibili-downloader-gui

## What this project is

A Tauri v2 desktop application (Rust backend in `src-tauri/`, React +
TypeScript frontend in `src/`) that downloads videos, audio, subtitles,
thumbnails and danmaku from bilibili.com, muxes streams with an external
ffmpeg binary, and manages a download queue with history.

## Assets we must protect

- **User bilibili credentials**: session cookies (SESSDATA etc.) obtained via
  QR login or imported by the user. They must never leave bilibili-owned
  domains and must never be logged or embedded in shared artifacts.
- **Local filesystem**: downloaded media files written into user-chosen
  directories.
- **Local settings/history** (`settings.json`, history store) — may contain
  the configured ffmpeg path and download preferences, no secrets beyond the
  cookies above.

## Where untrusted input enters

1. **bilibili API responses** (video/episode metadata, titles, upper names,
   episode lists) — titles are used to build output filenames.
2. **bilibili CDN responses** — downloaded media bytes, subtitles, danmaku
   XML/JSON.
3. **User-pasted URLs / BV ids** — parsed and resolved against bilibili.
4. **ffmpeg output** — parsed for progress and probe results
   (`utils/ffmpeg_progress.rs`, `utils/ffmpeg_probe.rs`).
5. **Updater feed** — tauri-plugin-updater with its signature verification.

## External processes

- **ffmpeg**: spawned by path (user-configurable in settings) with argument
  vectors, never through a shell string. All spawns set `CREATE_NO_WINDOW`
  on Windows.
- **curl** (system binary): some fetches shell out to curl
  (`fetch_url_via_curl` in `handlers/bilibili.rs`); the bilibili cookie
  header is passed as a command-line argument, so it is visible in local
  process listings while a fetch runs — worth auditing.
- **chmod**: spawned once in `handlers/ffmpeg.rs` to fix output file
  permissions.

## How to exercise it

- Frontend unit tests: `npx vitest run` (repo root).
- Backend unit + doc tests: `cd src-tauri && cargo test`.
- `e2e-tests/` needs a real bilibili login, Firefox and network — not
  exercisable in the offline audit VM.
- The app itself is a GUI; exercising binaries headlessly is not expected.
- Tests run as root in this image;
  `utils::downloads::tests::download_url_fallback_open_failure_stops_emitter`
  expects a permission-denied file creation (0o555 dir) that root bypasses,
  so it reports failure here — an environment artifact, not a bug.

## How to rate severity

- **Critical**: exfiltration of cookies/credentials to any non-bilibili
  destination, or remote code execution.
- **High**: arbitrary file write/read or path traversal outside the
  user-chosen download directory (e.g. via hostile filenames crafted from
  video titles); command injection into ffmpeg arguments; updater signature
  bypass.
- **Medium**: cookie leakage into logs/history files; SSRF reachable from
  parsed input; unsafe deserialization of API responses leading to crash
  with memory-safety implications.
- **Low**: denial of service / panics on malformed API or ffmpeg output.

Reports above medium that only reproduce on Windows-specific `CREATE_NO_WINDOW`
behavior still matter to us — releases ship Windows builds.

## Out of scope

- bilibili server-side vulnerabilities.
- `e2e-tests/` (local-only WebdriverIO harness, never shipped) and CI
  workflow definitions.
- Vulnerabilities in dependencies themselves (reported upstream); we care
  about how this codebase uses them.
