/**
 * GIF/WebM generator feature type definitions.
 *
 * Mirrors the Rust DTOs in `src-tauri/src/handlers/gif.rs`. Field names
 * are camelCase to align with `#[serde(rename_all = "camelCase")]` on the
 * backend.
 */

/**
 * Output format. `gif` generates a 256-color animated GIF; `webm`
 * generates a silent VP9 WebM.
 */
export type GifFormat = 'gif' | 'webm'

/**
 * Width preset. `original` keeps the source width; the numeric values
 * rescale with the aspect ratio preserved.
 */
export type GifWidthPreset = 'original' | '640' | '480' | '320'

/**
 * FPS preset for the output animation.
 */
export type GifFpsPreset = '15' | '10' | '24'

/**
 * Request payload for the `generate_animation` Tauri command.
 */
export type GifOptions = {
  /** Absolute path of the input `.mp4` file. */
  inputPath: string
  /** Start time in seconds. Required. */
  startTime: number
  /** End time in seconds. Required, must be > `startTime`. */
  endTime: number
  /** Absolute path for the output `.gif` / `.webm` file. */
  outputPath: string
  /** Output format. Defaults to `gif` when omitted. */
  format: GifFormat
  /** Target width in pixels, or `null` to keep the original width. */
  width: number | null
  /** Output frame rate (preset: 10/15/24). */
  fps: number
}

/**
 * Successful response from the `generate_animation` Tauri command.
 */
export type GifResult = {
  /** Absolute path of the written output file. */
  outputPath: string
}

/**
 * Payload for the `gif://progress` Tauri event emitted by ffmpeg while
 * generating. `progress` is 0–100. The frontend derives elapsed/remaining
 * from `currentTimeSec`, `totalDurationSec`, and a wall-clock start time.
 */
export type GifProgress = {
  progress: number
  currentTimeSec: number
  totalDurationSec: number
}

/**
 * Probed source video resolution (`probe_video_resolution` command result).
 */
export type VideoResolution = {
  width: number
  height: number
}
