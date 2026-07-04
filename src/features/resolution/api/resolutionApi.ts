/**
 * Resolution feature API layer.
 *
 * Thin wrappers around `invoke('extract_resolution', ...)` and
 * `invoke('probe_video_resolution', ...)` to keep Tauri coupling in a single
 * module — the rest of the feature depends on these functions, not on
 * `invoke` directly.
 */

import { invoke } from '@tauri-apps/api/core'

import type { ResolutionOptions, ResolutionResult } from '../types'

/**
 * Invokes the backend `extract_resolution` command.
 *
 * @param options - Resolution conversion parameters; see {@link ResolutionOptions}
 * @returns The output file path on success
 * @throws Error with a message beginning with `ERR::RESOLUTION_*` on failure
 */
export async function extractResolution(
  options: ResolutionOptions,
): Promise<ResolutionResult> {
  return invoke<ResolutionResult>('extract_resolution', { options })
}

/**
 * Invokes the backend `probe_video_resolution` command.
 *
 * @param inputPath - Absolute path of the media file to probe
 * @returns The video dimensions (width, height) in pixels, or `null` when unavailable
 */
export async function probeVideoResolution(
  inputPath: string,
): Promise<{ width: number; height: number } | null> {
  return invoke<{ width: number; height: number } | null>(
    'probe_video_resolution',
    { inputPath },
  )
}
