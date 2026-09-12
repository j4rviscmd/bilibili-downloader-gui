/**
 * GIF/WebM generator feature API layer.
 *
 * Thin wrapper around `invoke('generate_animation', ...)` to keep Tauri
 * coupling in a single module — the rest of the feature depends on this
 * function, not on `invoke` directly.
 */

import { invoke } from '@tauri-apps/api/core'

import type { GifOptions, GifResult, VideoResolution } from '../types'

/**
 * Invokes the backend `generate_animation` command.
 *
 * @param options - Generation parameters; see {@link GifOptions}
 * @returns The output file path on success
 * @throws Error with a message beginning with `ERR::GIF_*` on failure
 */
export async function generateAnimation(
  options: GifOptions,
): Promise<GifResult> {
  return invoke<GifResult>('generate_animation', { options })
}

/**
 * Invokes the backend `probe_video_resolution` command.
 *
 * @returns The source video dimensions, or `null` when the probe fails
 *   (e.g. no parsable `WxH` on the stream line)
 */
export async function probeVideoResolution(
  inputPath: string,
): Promise<VideoResolution | null> {
  return invoke<VideoResolution | null>('probe_video_resolution', {
    inputPath,
  })
}
