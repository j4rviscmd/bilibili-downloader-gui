import { useAppDispatch, useSelector } from '@/app/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  setError,
  setUpdateAvailable,
} from '@/features/updater/model/updaterSlice'
import { cn } from '@/shared/lib/utils'
import { getVersion } from '@tauri-apps/api/app'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const isDevMode = import.meta.env.DEV

/**
 * Update check button component for settings dialog.
 *
 * A React component that provides manual update checking functionality for the Bilibili Downloader GUI.
 * Displays current application version, interactive check button, and real-time status indicators.
 *
 * Features:
 * - Version display with fallback for unknown versions
 * - Manual update trigger with loading state
 * - Status badges for update availability and latest version
 * - Full accessibility support with ARIA attributes
 * - Development mode protection
 *
 * State Management:
 * - Local state: update status, application version
 * - Global state: update availability (via Redux updaterSlice)
 *
 * Component States:
 * - idle: Button ready for user interaction
 * - checking: Update check in progress (button disabled, spinning icon)
 * - done: Check completed (shows result badge)
 *
 * Accessibility:
 * - Button with aria-busy attribute for screen readers
 * - Status region with aria-live announcement
 * - Group role with descriptive aria-label
 *
 * @example
 * // Basic usage in settings dialog
 * <UpdateCheckButton />
 *
 * @returns {JSX.Element} - Fully accessible update check interface
 */
export function UpdateCheckButton() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const updater = useSelector((s) => s.updater)

  const [status, setStatus] = useState<'idle' | 'checking' | 'done'>('idle')
  const [appVersion, setAppVersion] = useState<string>('')

  // Get current app version on mount
  useEffect(() => {
    const fetchAppVersion = async () => {
      try {
        setAppVersion(await getVersion())
      } catch (e) {
        console.error('Failed to get app version:', e)
        setAppVersion(t('settings.update_check.unknown_version'))
      }
    }
    fetchAppVersion()
  }, [t])

  /**
   * Handles manual update check button click.
   *
   * Triggers an asynchronous update check using Tauri's updater plugin.
   * Manages component state transitions and error handling.
   * Integrates with global Redux state via updaterSlice.
   * Function is disabled in development mode for performance reasons.
   *
   * State Flow:
   * 1. Sets status to 'checking' and clears previous errors
   * 2. Calls Tauri's checkUpdate() API
   * 3. On success: Dispatches updateAvailable action and updates version display
   * 4. On failure: Dispatches error action and resets to idle state
   * 5. Sets status to 'done' on successful completion
   *
   * @throws {Error} - Wrapped and handled by try-catch block, dispatched to Redux state
   *
   * @remarks - Disabled in development mode (import.meta.env.DEV)
   *            Updates appVersion from updater API response when available
   */
  const handleCheck = useCallback(async () => {
    if (isDevMode) {
      console.warn('Update check is disabled in development mode')
      return
    }

    setStatus('checking')
    dispatch(setError(null))

    try {
      const update = await checkUpdate()
      if (update) {
        dispatch(
          setUpdateAvailable({
            available: true,
            latestVersion: update.version || null,
            currentVersion: update.currentVersion || null,
          }),
        )
        if (update.currentVersion && !appVersion) {
          setAppVersion(update.currentVersion)
        }
      } else if (!appVersion) {
        setAppVersion(t('settings.update_check.unknown_version'))
      }
      setStatus('done')
    } catch (e) {
      console.error('Update check failed:', e)
      dispatch(setError(t('settings.update_check.error')))
      setStatus('idle')
    }
  }, [dispatch, t, appVersion])

  /**
   * Renders the appropriate status badge based on current state and update availability.
   *
   * This function determines which badge to display based on:
   * - Current update check status (idle, checking, done)
   * - Global update availability from updater slice
   * - Application version information
   *
   * @returns JSX.Element | null - Status badge component or null if no badge should be shown
   *
   * Badge Display Logic:
   * - idle: No badge (returns null)
   * - updateAvailable: Green badge with version info
   * - done: Gray badge with current version info
   * - checking: Handled by button state, not this function
   */
  const getStatusBadge = () => {
    if (status === 'idle') return null

    if (updater.updateAvailable) {
      return (
        <Badge variant="default" className="shrink-0">
          {t('settings.update_check.available', {
            version: updater.latestVersion,
          })}
        </Badge>
      )
    }

    if (status === 'done') {
      return (
        <Badge variant="secondary" className="shrink-0">
          {t('settings.update_check.latest', { version: appVersion })}
        </Badge>
      )
    }

    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Current version display */}
      <div className="text-muted-foreground text-sm">
        {t('settings.current_version', { version: appVersion || '-' })}
      </div>

      {/* Update check button and status */}
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label={t('settings.update_check.aria_label')}
      >
        <Button
          type="button"
          variant="outline"
          onClick={handleCheck}
          disabled={status === 'checking' || isDevMode}
          aria-describedby="update-status"
          aria-busy={status === 'checking'}
        >
          <RefreshCw
            className={cn(
              'mr-2 size-4',
              status === 'checking' && 'animate-spin',
            )}
          />
          {t(`settings.update_check.button_${status}`)}
        </Button>

        <div
          id="update-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {getStatusBadge()}
        </div>
      </div>
    </div>
  )
}
