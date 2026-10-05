import { invoke } from '@tauri-apps/api/core'

/**
 * Resolves a directly playable MP4 preview URL via `get_preview_play_url`.
 *
 * The backend requests the HTML5 playurl variant (single muxed MP4, no
 * referer hotlink check, ≤1080p), so the URL feeds a plain `<video>`
 * element. Works logged out (backend sends the official `try_look`
 * guest param).
 *
 * @param bvid - Video BV id from a search result entry
 * @throws Error string from the backend, e.g. 'ERR::VIDEO_NOT_FOUND'
 */
export function fetchPreviewPlayUrl(bvid: string): Promise<string> {
  return invoke<string>('get_preview_play_url', { bvid })
}
