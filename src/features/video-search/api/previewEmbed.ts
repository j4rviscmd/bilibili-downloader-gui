import { invoke } from '@tauri-apps/api/core'

/** Placeholder rect in CSS px relative to the webview viewport. */
export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Opens the official video page in an overlay window over the
 * placeholder rect.
 *
 * The backend injects the stored session cookies before the page loads,
 * so logged-in users get the full experience (quality switching
 * included) with no extra login UX. See `handlers/preview_embed.rs` for
 * why the page must be first-party and not an embedded iframe.
 *
 * @param bvid - Video BV id from a search result entry
 * @param rect - Current placeholder rect measured by the dialog
 * @throws Error string from the backend, e.g. 'ERR::INVALID_BVID'
 */
export function openPreviewPlayer(
  bvid: string,
  rect: PreviewRect,
): Promise<void> {
  return invoke('open_preview_player', { bvid, rect })
}

/**
 * Re-positions the overlay after dialog/layout changes (the backend
 * handles main-window moves via its own Moved/Resized listener).
 */
export function syncPreviewPlayer(rect: PreviewRect): Promise<void> {
  return invoke('sync_preview_player', { rect })
}

/**
 * Pauses playback in the overlay without closing it ("open in
 * browser" keeps the dialog up; pausing avoids double audio).
 */
export function pausePreviewPlayer(): Promise<void> {
  return invoke('pause_preview_player')
}

/** Closes the overlay (dialog closed / entry switched). */
export function closePreviewPlayer(): Promise<void> {
  return invoke('close_preview_player')
}
