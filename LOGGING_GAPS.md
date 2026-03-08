# Logging Gaps Report

**Date:** 2026-03-08
**Worktree:** tauri-plugin-log
**Status:** Audit Complete

## Summary

This report identifies gaps in logging across the Rust backend and TypeScript frontend codebase.

## Rust Backend Logging Gaps

### Priority: HIGH

| File                    | Function                   | Line    | Current Status  | Recommended Action                             |
| ----------------------- | -------------------------- | ------- | --------------- | ---------------------------------------------- |
| `handlers/cookie.rs`    | `get_cookie`               | 122-181 | No logging      | Add info logs for cookie fetch success/failure |
| `handlers/cookie.rs`    | `find_firefox_cookie_file` | 70-98   | No logging      | Add debug log for Firefox DB search results    |
| `handlers/favorites.rs` | `fetch_favorite_folders`   | 63-118  | No logging      | Add info logs for API request/response         |
| `handlers/favorites.rs` | `fetch_favorite_videos`    | 168-235 | No logging      | Add info logs for API request/response         |
| `handlers/ffmpeg.rs`    | `validate_ffmpeg`          | 59-76   | No logging      | Add info log for validation result             |
| `handlers/ffmpeg.rs`    | `install_ffmpeg`           | 111-180 | No logging      | Add info logs for install progress             |
| `handlers/ffmpeg.rs`    | `merge_av`                 | 445-578 | No logging      | Add info logs for merge start/complete         |
| `handlers/ffmpeg.rs`    | `merge_avs`                | 596-797 | No logging      | Add info logs for subtitle merge               |
| `handlers/qr_login.rs`  | `generate_qr_code`         | 229-275 | debug_log! only | Add proper info logs for release builds        |
| `handlers/qr_login.rs`  | `poll_qr_status`           | 296-351 | debug_log! only | Add proper info logs for release builds        |

### Priority: MEDIUM

| File                   | Function           | Line       | Current Status  | Recommended Action                           |
| ---------------------- | ------------------ | ---------- | --------------- | -------------------------------------------- |
| `handlers/github.rs`   | `fetch_repo_stars` | 40-49      | No logging      | Add debug log for GitHub API calls           |
| `handlers/settings.rs` | `set_settings`     | 34-57      | Error logs only | Add info log for settings save               |
| `handlers/bilibili.rs` | `download_video`   | ~1100-1300 | Partial info    | Add logs for quality selection, CDN switches |
| `utils/wbi.rs`         | `fetch_mixin_key`  | 147-193    | No logging      | Add debug log for WBI key fetch              |

### Priority: LOW

| File                      | Function          | Line   | Current Status | Recommended Action  |
| ------------------------- | ----------------- | ------ | -------------- | ------------------- |
| `store/history_store.rs`  | `new/load/save`   | 42-93  | No logging     | Optional debug logs |
| `handlers/concurrency.rs` | `register/cancel` | 98-124 | No logging     | Optional debug logs |

## TypeScript Frontend Logging Gaps

**Note:** TypeScript logging is intentionally minimal. The app uses:

- Toast notifications (sonner) for user-facing messages
- Redux store for state management
- UI indicators for progress

### Recommended (Debug Only)

| File                                   | Function        | Priority | Recommendation       |
| -------------------------------------- | --------------- | -------- | -------------------- |
| `features/video/api/downloadVideo.ts`  | `downloadVideo` | Low      | Dev-only console.log |
| `features/video/api/fetchVideoInfo.ts` | API functions   | Low      | Dev-only console.log |
| `features/login/api/loginApi.ts`       | QR functions    | Low      | Dev-only console.log |
| `app/providers/ListenerContext.tsx`    | Event listeners | Low      | Dev-only console.log |

**TypeScript logging should be:** `if (import.meta.env.DEV) console.log(...)`

## Files with Existing Good Logging

- `lib.rs` - Error logging for cleanup
- `cleanup.rs` - Info/error logging for temp file cleanup
- `settings.rs` - Error logging for settings parse failures
- `downloads.rs` - Error logging for CDN rotation
- `analytics.rs` - Conditional debug logging
- `bilibili.rs` - Partial info logging for user/video info
- `updater.rs` - Info logging for update checks

## Implementation Guidelines

1. **Log Levels:**
   - `log::info!` - User operations, API calls, significant events
   - `log::error!` - Failures, errors
   - `log::debug!` - Detailed diagnostics

2. **Log Format:**

   ```rust
   log::info!("[BE] [ModuleName] Action: details");
   log::error!("[BE] [ModuleName] Error: {}", error);
   ```

3. **Sensitive Data Masking:**
   - Use `log_mask.rs` utilities for cookies, tokens, SESSDATA
   - Never log raw session data

4. **Conditional Compilation:**
   ```rust
   #[cfg(debug_assertions)]
   log::debug!("[BE] Detailed debug info");
   ```
