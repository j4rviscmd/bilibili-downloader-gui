import { useAppDispatch } from '@/app/store'
import {
  setDownloadProgress,
  setError,
  setIsDownloading,
  setIsUpdateReady,
} from '@/features/updater/model/updaterSlice'
import { logger } from '@/shared/lib/logger'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Hook that provides actions for the app update lifecycle.
 *
 * Manages downloading, retrying, and restarting the application
 * as part of the auto-update flow. Uses Redux to track download
 * progress and error state.
 *
 * @returns An object containing update action handlers.
 * @returns handleUpdate - Downloads the latest update and tracks
 *   progress via Redux. Dispatches error state on failure.
 * @returns handleRetry - Clears the current error and re-triggers
 *   the download.
 * @returns handleRestart - Relaunches the application to complete
 *   a pending update installation.
 */
export function useUpdateDownload() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  /**
   * Downloads the latest update and installs it.
   *
   * Checks for an available update, then downloads it while
   * reporting progress as a percentage (0-100) to the Redux store.
   * On successful completion, marks the update as ready for restart.
   * On failure, clears progress and sets the error state.
   */
  const handleUpdate = useCallback(async () => {
    try {
      dispatch(setIsDownloading(true))
      dispatch(setError(null))
      dispatch(setDownloadProgress(0))

      const update = await check()
      if (!update) {
        logger.error('No update available when trying to download')
        dispatch(setError(t('updater.error.no_update_available')))
        dispatch(setIsDownloading(false))
        return
      }

      let contentLength = 0
      let downloaded = 0

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0
            dispatch(setDownloadProgress(0))
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            dispatch(
              setDownloadProgress(
                contentLength > 0
                  ? Math.min(100, (downloaded / contentLength) * 100)
                  : 0,
              ),
            )
            break
          case 'Finished':
            dispatch(setDownloadProgress(100))
            dispatch(setIsUpdateReady(true))
            dispatch(setIsDownloading(false))
            break
        }
      })
    } catch (e) {
      logger.error('Update download/install failed', e)
      dispatch(setError(t('updater.error.download_failed')))
      dispatch(setIsDownloading(false))
      dispatch(setDownloadProgress(0))
    }
  }, [dispatch, t])

  /**
   * Clears the current error and re-attempts the update download.
   */
  const handleRetry = useCallback(() => {
    dispatch(setError(null))
    handleUpdate()
  }, [dispatch, handleUpdate])

  /**
   * Relaunches the application to apply a completed update.
   *
   * Should only be called after a successful download when the
   * update is marked as ready. Sets an error state if the
   * relaunch fails.
   */
  const handleRestart = useCallback(async () => {
    logger.info(
      'UpdateNotification: User requested application restart after update',
    )
    try {
      await relaunch()
    } catch (e) {
      logger.error('Restart failed', e)
      dispatch(setError(t('updater.error.restart_failed')))
    }
  }, [dispatch, t])

  return { handleUpdate, handleRetry, handleRestart }
}
