/** Progress payload received from the backend via `concat://progress` events. */
export type ConcatProgress = {
  /** Concatenation progress as a percentage (0 to 100). */
  progress: number
  /** Current processing time in seconds. */
  currentTimeSec: number
  /** Total duration of all input files combined, in seconds. */
  totalDurationSec: number
}

/** Options sent to the Tauri backend `concat_videos` command. */
export type ConcatOptions = {
  /** Absolute file paths of the MP4 videos to concatenate, in order. */
  inputPaths: string[]
  /** Absolute file path for the output MP4 file. */
  outputPath: string
}

/** Result returned by the backend on successful concatenation. */
export type ConcatResult = {
  /** Absolute file path of the concatenated output video. */
  outputPath: string
}
