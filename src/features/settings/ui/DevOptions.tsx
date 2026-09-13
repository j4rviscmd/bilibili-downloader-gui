import type { RootState } from '@/app/store'
import { SettingRow } from '@/features/settings/ui/SettingRow'
import { useSettings } from '@/features/settings/useSettings'
import { useUser } from '@/features/user'
import { logger } from '@/shared/lib/logger'

import { Separator } from '@/shared/ui/separator'
import { Switch } from '@/shared/ui/switch'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'

/**
 * Developer options section (dev builds only).
 *
 * Formerly a collapsible card inside the settings dialog; now a dedicated
 * settings-page category, so the options render flat like every other
 * section (the category nav already provides the separation).
 */
export function DevOptions() {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const { onChangeUser, getUserInfo } = useUser()
  const { settings, saveByForm } = useSettings()
  const simulateLogout = useSelector(
    (state: RootState) => state.dev?.simulateLogout ?? false,
  )

  const handleToggleSimulateLogout = async (checked: boolean) => {
    // Set backend simulate logout flag (development mode only)
    try {
      await invoke('set_simulate_logout', { enabled: checked })
    } catch (error) {
      logger.error(
        'handleToggleSimulateLogout: Failed to set simulate logout state',
        error,
      )
    }

    dispatch({ type: 'dev/setSimulateLogout', payload: checked })

    if (checked) {
      // Simulate non-logged-in state
      onChangeUser({
        code: 0,
        message: '',
        ttl: 1,
        data: {
          mid: undefined,
          uname: '',
          isLogin: false,
          wbiImg: {
            imgUrl: '',
            subUrl: '',
          },
        },
        hasCookie: false,
      })
    } else {
      // Restore actual user state
      await getUserInfo()
    }
  }

  const handleToggleDevtools = (checked: boolean) => {
    saveByForm({ openDevtoolsOnStartup: checked })
  }

  const handleToggleDevUpdater = (checked: boolean) => {
    saveByForm({ enableDevUpdater: checked })
  }

  // Only show in development mode
  if (!import.meta.env.DEV) {
    return null
  }

  return (
    <div className="space-y-6">
      <SettingRow
        label={t('settings.dev_options.open_devtools_on_startup')}
        htmlFor="open-devtools-on-startup"
        description={t(
          'settings.dev_options.open_devtools_on_startup_description',
        )}
      >
        <Switch
          id="open-devtools-on-startup"
          checked={settings.openDevtoolsOnStartup ?? true}
          onCheckedChange={handleToggleDevtools}
        />
      </SettingRow>
      <Separator />
      <SettingRow
        label={t('settings.dev_options.enable_dev_updater')}
        htmlFor="enable-dev-updater"
        description={t('settings.dev_options.enable_dev_updater_description')}
      >
        <Switch
          id="enable-dev-updater"
          checked={settings.enableDevUpdater ?? false}
          onCheckedChange={handleToggleDevUpdater}
        />
      </SettingRow>
      <Separator />
      <SettingRow
        label={t('settings.dev_options.simulate_logout')}
        htmlFor="simulate-logout"
        description={t('settings.dev_options.simulate_logout_description')}
      >
        <Switch
          id="simulate-logout"
          checked={simulateLogout}
          onCheckedChange={handleToggleSimulateLogout}
        />
      </SettingRow>
    </div>
  )
}
