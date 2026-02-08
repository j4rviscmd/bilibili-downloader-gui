/**
 * State interface for the updater feature.
 */
export interface UpdaterState {
  /** Whether an update is available */
  updateAvailable: boolean
  /** Latest version available (e.g., "v1.2.1") */
  latestVersion: string | null
  /** Current application version */
  currentVersion: string | null
  /** Release notes in Markdown format */
  releaseNotes: string | null
  /** Download progress percentage (0-100) */
  downloadProgress: number
  /** Whether the update is currently downloading */
  isDownloading: boolean
  /** Whether the update is downloaded and ready to install */
  isUpdateReady: boolean
  /** Error message if update check/download failed */
  error: string | null
  /** Whether to show the update notification dialog */
  showDialog: boolean
}
