import { fetchReleaseNotes } from '@/features/updater'
import {
  setReleaseNotes,
  setUpdateAvailable,
} from '@/features/updater/model/updaterSlice'
import { useAppDispatch } from '@/app/store'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Provider component for automatic update checking.
 *
 * Checks for updates on mount and fetches release notes from GitHub.
 * Automatically handles the update flow without forcing immediate installation.
 *
 * @param props - Component props
 * @param props.children - Child components to be wrapped by this provider
 *
 * @example
 * ```tsx
 * <UpdaterProvider>
 *   <App />
 * </UpdaterProvider>
 * ```
 */
export const UpdaterProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  useEffect(() => {
    const checkForUpdates = async () => {
      // Skip update check in development
      if (import.meta.env.DEV) {
        return
      }

      try {
        // Check for updates using Tauri's updater plugin
        const update = await checkUpdate()

        if (!update) {
          // No update available
          return
        }

        // Update is available - fetch release notes
        const latestVersion = update.version || 'unknown'
        const currentVersion = update.currentVersion || 'unknown'

        // Set update available state
        dispatch(
          setUpdateAvailable({
            available: true,
            latestVersion,
            currentVersion,
          }),
        )

        // Fetch release notes from GitHub
        try {
          const owner = 'j4rviscmd'
          const repo = 'bilibili-downloader-gui'

          const notes = await fetchReleaseNotes(owner, repo, currentVersion)
          dispatch(setReleaseNotes(notes))
        } catch (e) {
          console.error('[Updater] Failed to fetch release notes:', e)
          // Continue without release notes
          dispatch(setReleaseNotes(t('updater.no_release_notes')))
        }
      } catch (e) {
        console.error('[Updater] Update check failed:', e)
        // Silently fail - don't bother the user if update check fails
      }
    }

    checkForUpdates()
  }, [dispatch])

  return <>{children}</>
}
