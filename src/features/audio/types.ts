/**
 * Audio feature type definitions.
 *
 * Mirrors the Rust DTOs in `src-tauri/src/handlers/audio.rs`. Field names
 * are camelCase to align with `#[serde(rename_all = "camelCase")]` on the
 * backend.
 */

/**
 * Output audio format. `mp3` uses the libmp3lame encoder; `m4a` uses AAC
 * inside an MP4 container.
 */
export type AudioFormat = 'mp3' | 'm4a'

/**
 * Request payload for the `extract_audio` Tauri command.
 */
export type AudioOptions = {
  /** Absolute path of the input `.mp4` file. */
  inputPath: string
  /** Absolute path for the output file. Extension must match `format`. */
  outputPath: string
  /** Target audio format. */
  format: AudioFormat
  /** Target bitrate in kbps (128 / 192 / 256 / 320). */
  bitrateKbps: number
}

/**
 * Successful response from the `extract_audio` Tauri command.
 */
export type AudioResult = {
  /** Absolute path of the written output file. */
  outputPath: string
}

/**
 * Payload for the `audio://progress` Tauri event emitted by ffmpeg while
 * extracting. `progress` is 0–100. The frontend derives elapsed/remaining
 * from `currentTimeSec`, `totalDurationSec`, and a wall-clock start time.
 */
export type AudioProgress = {
  progress: number
  currentTimeSec: number
  totalDurationSec: number
}
