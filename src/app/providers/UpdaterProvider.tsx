import { useAppDispatch } from '@/app/store'
import { callGetSettings } from '@/features/settings/api/settingApi'
import { fetchReleaseNotes } from '@/features/updater'
import {
  setReleaseNotes,
  setUpdateAvailable,
} from '@/features/updater/model/updaterSlice'
import { logger } from '@/shared/lib/logger'
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
      // Why read settings from disk up front: Redux hydration (initApp)
      //   races this effect, so the store may not hold settings yet. One
      //   read feeds both gates below. Failure directions are chosen per
      //   gate: the dev gate fails closed (undefined flag = updater off in
      //   dev), the skip check fails open (dialog shows — pre-#599
      //   behavior).
      const settings = await callGetSettings().catch(() => undefined)

      // Dev builds skip the updater flow unless the developer opts in via
      // the Developer Options toggle (default off).
      if (import.meta.env.DEV && !(settings?.enableDevUpdater ?? false)) {
        return
      }

      try {
        const update = await checkUpdate()
        if (!update) {
          return
        }

        const latestVersion = update.version || 'unknown'
        const currentVersion = update.currentVersion || 'unknown'

        const autoShow = settings?.skippedUpdateVersion !== latestVersion

        dispatch(
          setUpdateAvailable({
            available: true,
            latestVersion,
            currentVersion,
            showDialog: autoShow,
          }),
        )

        try {
          // Only fetch notes when the dialog will actually be shown: a
          // suppressed (skipped) version burns GitHub API quota for
          // nothing (unauthenticated limit is 60 req/h). The manual check
          // in Settings fetches notes on its own when it opens the dialog.
          if (autoShow) {
            const notes = await fetchReleaseNotes(OWNER, REPO, currentVersion)
            dispatch(setReleaseNotes(notes))
          }
        } catch (e) {
          logger.error('Failed to fetch release notes', e)
          dispatch(setReleaseNotes(t('updater.no_release_notes')))
        }
      } catch (e) {
        logger.error('Update check failed', e)
      }
    }

    checkForUpdates()
  }, [dispatch, t])

  return <>{children}</>
}
