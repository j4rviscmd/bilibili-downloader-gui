/**
 * Trim feature API layer.
 *
 * Thin wrapper around `invoke('trim_video', ...)` to keep Tauri coupling
 * in a single module — the rest of the feature depends on this function,
 * not on `invoke` directly.
 */

import { invoke } from '@tauri-apps/api/core'

import type { TrimOptions, TrimResult } from '../types'

/**
 * Invokes the backend `trim_video` command.
 *
 * @param options - Trim parameters; see {@link TrimOptions}
 * @returns The output file path on success
 * @throws Error with a message beginning with `ERR::TRIM_*` on failure
 */
export async function trimVideo(options: TrimOptions): Promise<TrimResult> {
  return invoke<TrimResult>('trim_video', { options })
}
