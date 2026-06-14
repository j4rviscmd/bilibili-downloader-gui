import { invoke } from '@tauri-apps/api/core'

import type { ConcatOptions, ConcatResult } from '../types'

/**
 * Invokes the Tauri backend to concatenate multiple video files.
 *
 * @param options - Input file paths and the desired output path.
 * @returns A promise that resolves to the result containing the output path.
 * @throws When ffmpeg fails or validation errors occur (backend `ERR::*` codes).
 */
export async function concatVideos(
  options: ConcatOptions,
): Promise<ConcatResult> {
  return invoke<ConcatResult>('concat_videos', { options })
}
