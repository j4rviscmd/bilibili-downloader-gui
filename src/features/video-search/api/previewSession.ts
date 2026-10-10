import { invoke } from '@tauri-apps/api/core'

/** One live preview HLS session from `open_preview_session`. */
export interface PreviewSessionInfo {
  /** Opaque session token (pass back to `closePreviewSession`). */
  token: string
  /** `stream://` path of the live-growing HLS playlist (feed through
   * `convertFileSrc(path, 'stream')`). */
  playlist: string
  /** Full video duration in seconds. */
  durationSec: number
  /** Where generation stops (min(duration, 15 minutes)); the playlist gets
   * `#EXT-X-ENDLIST` there. */
  cappedAtSec: number
}

/**
 * Opens an HLS preview session via `open_preview_session`.
 *
 * The backend resolves the CDN pair (≤1080p AVC), starts ffmpeg remuxing
 * it to fMP4 HLS through the Rust loopback relay, and returns the playlist
 * path. Playback must go through `stream://` (the relay owns every CDN
 * fetch). Generation progress and failures arrive as
 * `preview-hls-progress` / `preview-hls-error` events.
 *
 * @param bvid - Video BV id from a search result entry
 * @throws Error string from the backend, e.g. 'ERR::VIDEO_NOT_FOUND'
 */
export function openPreviewSession(bvid: string): Promise<PreviewSessionInfo> {
  return invoke<PreviewSessionInfo>('open_preview_session', { bvid })
}

/** Closes a session: kills its ffmpeg child and removes the generated
 * segments. Called on dialog close/entry switch/unmount. */
export function closePreviewSession(token: string): Promise<void> {
  return invoke<void>('close_preview_session', { token })
}
