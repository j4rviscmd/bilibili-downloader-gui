/**
 * Resolution feature type definitions.
 *
 * Mirrors the Rust DTOs in `src-tauri/src/handlers/resolution.rs`. Field names
 * are camelCase to align with `#[serde(rename_all = "camelCase")]` on the
 * backend.
 */

/**
 * Request payload for the `extract_resolution` Tauri command.
 */
export type ResolutionOptions = {
  /** Absolute path of the input `.mp4` file. */
  inputPath: string
  /** Absolute path for the output file. Must be `.mp4`. */
  outputPath: string
  /** Target height in pixels (e.g. 1080, 720, 480, 360). Width is auto-calculated. */
  targetHeight: number
}

/**
 * Successful response from the `extract_resolution` Tauri command.
 */
export type ResolutionResult = {
  /** Absolute path of the written output file. */
  outputPath: string
}

/**
 * Payload for the `resolution://progress` Tauri event emitted by ffmpeg while
 * converting. `progress` is 0–100. The frontend derives elapsed/remaining
 * from `currentTimeSec`, `totalDurationSec`, and a wall-clock start time.
 */
export type ResolutionProgress = {
  progress: number
  currentTimeSec: number
  totalDurationSec: number
}
