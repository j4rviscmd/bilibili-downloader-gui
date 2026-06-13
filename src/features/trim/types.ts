/**
 * Trim feature type definitions.
 *
 * Mirrors the Rust DTOs in `src-tauri/src/handlers/trim.rs`. Field names
 * are camelCase to align with `#[serde(rename_all = "camelCase")]` on the
 * backend.
 */

/**
 * Trim mode. `copy` is lossless and fast but snaps to keyframes; `reencode`
 * is frame-accurate but slower and lossy.
 */
export type TrimMode = 'copy' | 'reencode'

/**
 * Request payload for the `trim_video` Tauri command.
 */
export type TrimOptions = {
  /** Absolute path of the input `.mp4` file. */
  inputPath: string
  /** Start time in seconds. `null` means from the beginning. */
  startTime: number | null
  /** End time in seconds. `null` means to the end. */
  endTime: number | null
  /** Absolute path for the output `.mp4` file. */
  outputPath: string
  /** Trim mode. Defaults to `copy` when omitted. */
  mode: TrimMode
}

/**
 * Successful response from the `trim_video` Tauri command.
 */
export type TrimResult = {
  /** Absolute path of the written output file. */
  outputPath: string
}

/**
 * Payload for the `trim://progress` Tauri event emitted by ffmpeg while
 * trimming. `progress` is 0–100. The frontend derives elapsed/remaining from
 * `currentTimeSec`, `totalDurationSec`, and a wall-clock start time.
 */
export type TrimProgress = {
  progress: number
  currentTimeSec: number
  totalDurationSec: number
}
