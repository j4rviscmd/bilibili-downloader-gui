import { invoke } from '@tauri-apps/api/core'

/** Resolved preview tracks from `get_preview_play_url`, as webview-facing
 * `stream://` proxy paths (feed through `convertFileSrc(path, 'stream')`). */
export interface PreviewPlayInfo {
  video: string
  /** Separate DASH audio track path; null for durl muxed previews (muted
   * playback) — the backend only reports it when a distinct audio stream
   * exists. */
  audio: string | null
}

/**
 * Resolves preview stream paths via `get_preview_play_url`.
 *
 * The backend resolves the PC DASH manifest (the same lane the official web
 * player uses — the html5 durl lane is quota-starved for overseas
 * non-browser clients at peak hours) and returns opaque proxy paths for the
 * best video track and its separate audio track. The webview must fetch
 * them through the Rust `stream://` proxy (Sec-Fetch-Dest hotlink blocks,
 * Referer 403s, and WKWebView QUIC stalls all vanish when reqwest fetches
 * instead — see handlers/preview_stream.rs).
 *
 * @param bvid - Video BV id from a search result entry
 * @throws Error string from the backend, e.g. 'ERR::VIDEO_NOT_FOUND'
 */
export function fetchPreviewPlayUrl(bvid: string): Promise<PreviewPlayInfo> {
  return invoke<PreviewPlayInfo>('get_preview_play_url', { bvid })
}
