import { store, useSelector } from '@/app/store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  setFirefoxAccessDenied,
  setFirefoxPermissionDismissed,
} from '@/features/init'
import { useUser } from '@/features/user'
import { logger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCookie, openMacosPrivacySettings } from '../api/loginApi'

const retryErrorKeys = {
  accessDenied: 'login.firefoxPermissionStillDenied',
  noCookies: 'login.firefoxPermissionNoCookies',
}
type RetryError = keyof typeof retryErrorKeys

export function FirefoxPermissionDialog() {
  const { t } = useTranslation()
  const open = useSelector(
    (state) =>
      state.init.firefoxAccessDenied && !state.init.firefoxPermissionDismissed,
  )
  const { getUserInfo } = useUser()
  const [error, setError] = useState<RetryError | null>(null)
  const [retrying, setRetrying] = useState(false)

  const dismiss = () => {
    store.dispatch(setFirefoxPermissionDismissed(true))
    setError(null)
  }

  const handleOpenSettings = async () => {
    try {
      await openMacosPrivacySettings()
    } catch (e) {
      logger.error(
        'FirefoxPermissionDialog: Failed to open privacy settings',
        e,
      )
      toast.error(t('login.firefoxPermissionOpenFailed'))
    }
  }

  const handleRetry = async () => {
    setRetrying(true)
    setError(null)
    try {
      const outcome = await getCookie()
      if (outcome !== 'loaded') {
        setError(outcome)
        toast.error(t(retryErrorKeys[outcome]))
        return
      }
      const user = await getUserInfo()
      store.dispatch(setFirefoxAccessDenied(false))
      if (!user.data.isLogin) {
        toast.error(t('login.firefoxPermissionNoCookies'))
        return
      }
      toast.success(t('login.firefoxPermissionLoaded'))
    } catch (e) {
      logger.error('FirefoxPermissionDialog: Retry failed', e)
      toast.error(t('login.firefoxPermissionRetryFailed'))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('login.firefoxPermissionTitle')}</DialogTitle>
          <DialogDescription>
            {t('login.firefoxPermissionDescription')}
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>{t('login.firefoxPermissionStepNotification')}</li>
          <li>{t('login.firefoxPermissionStepSettings')}</li>
          <li>{t('login.firefoxPermissionStepRetry')}</li>
        </ol>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {t(retryErrorKeys[error])}
          </p>
        )}
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" onClick={dismiss}>
            {t('actions.close')}
          </Button>
          <Button variant="outline" onClick={handleRetry} disabled={retrying}>
            {t('login.firefoxPermissionRetry')}
          </Button>
          <Button onClick={handleOpenSettings}>
            {t('login.firefoxPermissionOpenSettings')}
          </Button>
        </DialogFooter>
        <p className="text-muted-foreground text-xs">
          {t('login.firefoxPermissionHint')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
