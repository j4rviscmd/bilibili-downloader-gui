/**
 * Audio feature API layer.
 *
 * Thin wrappers around `invoke('extract_audio', ...)` and
 * `invoke('probe_audio_bitrate', ...)` to keep Tauri coupling in a single
 * module — the rest of the feature depends on these functions, not on
 * `invoke` directly.
 */

import { invoke } from '@tauri-apps/api/core'

import type { AudioOptions, AudioResult } from '../types'

/**
 * Invokes the backend `extract_audio` command.
 *
 * @param options - Extraction parameters; see {@link AudioOptions}
 * @returns The output file path on success
 * @throws Error with a message beginning with `ERR::AUDIO_*` on failure
 */
export async function extractAudio(
  options: AudioOptions,
): Promise<AudioResult> {
  return invoke<AudioResult>('extract_audio', { options })
}

/**
 * Invokes the backend `probe_audio_bitrate` command.
 *
 * @param inputPath - Absolute path of the media file to probe
 * @returns The audio stream bitrate in kbps, or `null` when ffmpeg reports
 *   no concrete bitrate (e.g. VBR)
 */
export async function probeAudioBitrate(
  inputPath: string,
): Promise<number | null> {
  return invoke<number | null>('probe_audio_bitrate', { inputPath })
}
