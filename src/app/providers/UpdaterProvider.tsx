import { useAppDispatch } from '@/app/store'
import { fetchReleaseNotes } from '@/features/updater'
import {
  setReleaseNotes,
  setUpdateAvailable,
} from '@/features/updater/model/updaterSlice'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const OWNER = 'j4rviscmd' as const
const REPO = 'bilibili-downloader-gui' as const

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
      if (import.meta.env.DEV) {
        return
      }

      try {
        const update = await checkUpdate()
        if (!update) {
          return
        }

        const latestVersion = update.version || 'unknown'
        const currentVersion = update.currentVersion || 'unknown'

        dispatch(
          setUpdateAvailable({
            available: true,
            latestVersion,
            currentVersion,
          }),
        )

        try {
          const notes = await fetchReleaseNotes(OWNER, REPO, currentVersion)
          dispatch(setReleaseNotes(notes))
        } catch (e) {
          console.error('[Updater] Failed to fetch release notes:', e)
          dispatch(setReleaseNotes(t('updater.no_release_notes')))
        }
      } catch (e) {
        console.error('[Updater] Update check failed:', e)
      }
    }

    checkForUpdates()
  }, [dispatch, t])

  return <>{children}</>
}
