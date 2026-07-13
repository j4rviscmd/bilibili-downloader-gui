/**
 * Rotation feature type definitions.
 *
 * Mirrors the Rust DTOs in `src-tauri/src/handlers/rotation.rs`. Field names
 * are camelCase to align with `#[serde(rename_all = "camelCase")]` on the
 * backend.
 */

/**
 * Rotation angle in clockwise degrees.
 */
export type RotationAngle = 90 | 180 | 270

/**
 * Rotation mode. `copy` is lossless and fast but some players may ignore the
 * metadata flag; `reencode` is frame-accurate and works in all players but
 * slower and lossy.
 */
export type RotationMode = 'copy' | 'reencode'

/**
 * Request payload for the `rotate_video` Tauri command.
 */
export type RotationOptions = {
  /** Absolute path of the input `.mp4` file. */
  inputPath: string
  /** Absolute path for the output `.mp4` file. */
  outputPath: string
  /** Rotation angle in clockwise degrees. */
  angle: RotationAngle
  /** Rotation mode. Defaults to `copy` when omitted. */
  mode: RotationMode
}

/**
 * Successful response from the `rotate_video` Tauri command.
 */
export type RotationResult = {
  /** Absolute path of the written output file. */
  outputPath: string
}

/**
 * Payload for the `rotation://progress` Tauri event emitted by ffmpeg while
 * rotating. `progress` is 0–100. The frontend derives elapsed/remaining from
 * `currentTimeSec`, `totalDurationSec`, and a wall-clock start time.
 */
export type RotationProgress = {
  progress: number
  currentTimeSec: number
  totalDurationSec: number
}
