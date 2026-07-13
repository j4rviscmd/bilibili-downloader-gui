/**
 * Rotation feature API layer.
 *
 * Thin wrapper around `invoke('rotate_video', ...)` to keep Tauri coupling
 * in a single module — the rest of the feature depends on this function,
 * not on `invoke` directly.
 */

import { invoke } from '@tauri-apps/api/core'

import type { RotationOptions, RotationResult } from '../types'

/**
 * Invokes the backend `rotate_video` command.
 *
 * @param options - Rotation parameters; see {@link RotationOptions}
 * @returns The output file path on success
 * @throws Error with a message beginning with `ERR::ROTATION_*` on failure
 */
export async function rotateVideo(
  options: RotationOptions,
): Promise<RotationResult> {
  return invoke<RotationResult>('rotate_video', { options })
}
