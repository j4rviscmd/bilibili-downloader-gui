/**
 * Progress data structure for download tracking.
 *
 * Emitted from the Rust backend via Tauri events.
 */
export type Progress = {
  /** Unique download identifier */
  downloadId: string
  /** Time delta since last update (in seconds) */
  deltaTime: number
  /** Total file size (in MB) */
  filesize: number
  /** Downloaded size (in MB) */
  downloaded: number
  /** Download speed (in KB/s) */
  transferRate: number
  /** Download percentage (0-100) */
  percentage: number
  /** Cumulative elapsed time (in seconds) */
  elapsedTime: number
  /** Whether this stage is complete */
  isComplete: boolean
  /** Download stage ('audio', 'video', 'merge', 'complete') */
  stage?: string
  /** Parent download ID for multi-part downloads */
  parentId?: string
  /** Internal ID computed from downloadId and stage */
  internalId?: string
}
