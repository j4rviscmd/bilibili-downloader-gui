/**
 * State shape for the initialization feature.
 *
 * Tracks application startup progress and status messages.
 */
export interface InitState {
  /** Whether the initialization sequence has completed */
  initiated: boolean
  /** Current initialization status message (e.g., 'Checking ffmpeg...') */
  processingFnc: string
}
