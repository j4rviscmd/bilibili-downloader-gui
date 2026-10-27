/**
 * FirefoxCookiePanel Component
 *
 * Firefox-cookie entry inside the login dialog. Switching to Firefox
 * cannot activate live (the backend reads Firefox cookies only at app
 * startup in init), so the switch is persisted and the app relaunched —
 * the same flow as the settings account section.
 *
 * @module FirefoxCookiePanel
 */

import { store } from '@/app/store'
import { logger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/button'
import { relaunch } from '@tauri-apps/plugin-process'
import { Globe } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setLoginMethod } from '../api/loginApi'
import { setLoginMethod as setLoginMethodAction } from '../model/loginSlice'
import { RestartConfirmDialog } from './RestartConfirmDialog'

/**
 * Persists the Firefox method and relaunches. Cookie caches and
 * login-derived state live in too many places to reset by hand, so the
 * switch is applied via relaunch (same rationale as the settings
 * account section). The store sync exists for the relaunch-failure
 * path, where the app keeps running with the persisted switch.
 */
// Note: the startup-only read lives in src-tauri/src/handlers/init.rs
// (LoginMethod::Firefox branch); set_login_method only clears the cookie
// cache, it never repopulates Firefox cookies (src-tauri/src/handlers/qr_login.rs)
async function switchToFirefox(): Promise<void> {
  await setLoginMethod('firefox')
  store.dispatch(setLoginMethodAction('firefox'))
  await relaunch()
}

/**
 * Renders the Firefox-cookie switch panel.
 *
 * @returns Description, switch button, and the restart-confirmation
 *   dialog.
 */
export function FirefoxCookiePanel() {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [restartFailed, setRestartFailed] = useState(false)

  const handleRestart = async () => {
    // Clear per attempt so a successful retry drops the previous failure
    setRestartFailed(false)
    try {
      await switchToFirefox()
    } catch (error) {
      logger.error('Failed to switch to Firefox login method', error)
      setRestartFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-muted-foreground text-xs">
        {t('login.firefoxCookieDescription')}
      </p>
      <Button onClick={() => setConfirming(true)}>
        <Globe className="size-4" aria-hidden="true" />
        {t('login.useFirefoxCookie')}
      </Button>
      <RestartConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={handleRestart}
        failed={restartFailed}
      />
    </div>
  )
}
