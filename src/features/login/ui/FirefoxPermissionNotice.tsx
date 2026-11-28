import { store, useSelector } from '@/app/store'
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
import { getCookie } from '../api/loginApi'

type FirefoxPermissionNoticeProps = {
  onResolved?: () => void
}

export function FirefoxPermissionNotice({
  onResolved,
}: FirefoxPermissionNoticeProps) {
  const { t } = useTranslation()
  const show = useSelector(
    (state) =>
      state.init.firefoxAccessDenied && state.login.loginMethod === 'firefox',
  )
  const { user, getUserInfo } = useUser()
  const [checking, setChecking] = useState(false)

  if (!show || (user.hasCookie && user.data.isLogin)) return null

  const handleCheck = async () => {
    setChecking(true)
    try {
      const outcome = await getCookie()
      if (outcome === 'accessDenied') {
        store.dispatch(setFirefoxPermissionDismissed(false))
        return
      }
      if (outcome === 'noCookies') {
        toast.error(t('login.firefoxPermissionNoCookies'))
        return
      }
      const refreshedUser = await getUserInfo()
      store.dispatch(setFirefoxAccessDenied(false))
      if (!refreshedUser.data.isLogin) {
        toast.error(t('login.firefoxPermissionNoCookies'))
        return
      }
      toast.success(t('login.firefoxPermissionLoaded'))
      onResolved?.()
    } catch (e) {
      logger.error('FirefoxPermissionNotice: Permission check failed', e)
      toast.error(t('login.firefoxPermissionRetryFailed'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="border-border bg-muted/40 flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground text-sm">
        {t('login.firefoxPermissionNotice')}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleCheck}
        disabled={checking}
      >
        {t('login.firefoxPermissionCheck')}
      </Button>
    </div>
  )
}
