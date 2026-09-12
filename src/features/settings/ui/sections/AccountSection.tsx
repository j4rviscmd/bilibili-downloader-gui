import { store, type RootState } from '@/app/store'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  getLoginState,
  getLoginStatusText,
  ManualCookieForm,
  qrLogout,
  sessionToUser,
  setLoginMethodAction,
  setLoginMethod as setLoginMethodApi,
  setSession,
  type LoginMethod,
  type Session,
} from '@/features/login'
import { SettingChoiceCards } from '@/features/settings/ui/SettingChoiceCards'
import { SettingField } from '@/features/settings/ui/SettingRow'
import { fetchUser, useUser } from '@/features/user'
import { setUser } from '@/features/user/userSlice'
import { logger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { toast } from '@/shared/ui/toast'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

/** Dispatches a fetched login state into the login slice. */
function applyLoginState(state: {
  method: LoginMethod
  session: Session | null
}) {
  store.dispatch(setLoginMethodAction(state.method))
  store.dispatch(setSession(state.session))
}

/**
 * Account category: Bilibili login method selection, manual cookie entry,
 * live login status and logout.
 *
 * Selection state lives in the login slice, hydrated at app init — the
 * section renders the persisted method on first paint (no firefox-default
 * flash). The mount effect still re-reads the backend state so a parallel
 * app instance's changes are picked up on category entry.
 */
export function AccountSection() {
  const { t } = useTranslation()
  const { user } = useUser()
  const loginMethod = useSelector((state: RootState) => state.login.loginMethod)
  const session = useSelector((state: RootState) => state.login.session)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  // Re-read login state on mount (multi-instance / splash-window changes);
  // the store already holds the init-hydrated values for first paint.
  useEffect(() => {
    getLoginState()
      .then(applyLoginState)
      .catch((error) => {
        logger.error('Failed to get login state', error)
      })
  }, [])

  /**
   * Refreshes login state from the backend and syncs userSlice.
   *
   * Used after operations that change server-side session state (logout,
   * login-method switch) so the section and AppBar stay consistent. The
   * user is fetched from the live nav API rather than derived from the
   * session file so a stale QR session that failed verification does not
   * incorrectly appear as logged-in (see review P1).
   */
  const refreshLoginState = async () => {
    const state = await getLoginState()
    applyLoginState(state)
    try {
      const user = await fetchUser()
      store.dispatch(setUser(user))
    } catch {
      // Fallback to file-derived user when the API is unreachable (e.g.
      // network offline). This keeps the UI responsive while still
      // preferring the live state when available.
      store.dispatch(setUser(sessionToUser(state.session)))
    }
    return state
  }

  /** Handles QR logout with confirmation. */
  const handleLogout = async () => {
    try {
      await qrLogout()
      setShowLogoutDialog(false)
      toast.success(t('login.qrSessionDeleted'))

      // Get fresh login state and update UI smoothly
      const state = await refreshLoginState()

      if (state.session) {
        toast.info(t('login.usingFirefoxCookie'))
      }
    } catch (error) {
      logger.error('QR logout failed', error)
    }
  }

  /**
   * Switches the preferred login method.
   *
   * Persists the new method via `set_login_method` (the backend always
   * clears the in-memory cookie cache on a switch). Only switching to
   * Firefox needs a restart — Firefox cookies are read exclusively during
   * app init. QR and Manual log in live (scan/paste commits to the cache
   * immediately), so those switches stay silent and the login action itself
   * is the feedback.
   */
  const handleLoginMethodChange = async (value: string) => {
    const next = value as LoginMethod
    if (next === loginMethod) return
    try {
      await setLoginMethodApi(next)
      await refreshLoginState()
      if (next === 'firefox') {
        toast.success(t('login.loginMethodChanged'))
        toast.info(t('login.restartRequired'))
      }
    } catch (error) {
      logger.error('Failed to change login method', error)
    }
  }

  return (
    <div className="space-y-6">
      <SettingField
        label={t('login.loginMethod')}
        description={t('login.loginMethodDescription')}
      >
        <SettingChoiceCards
          value={loginMethod}
          onValueChange={handleLoginMethodChange}
          columns="grid-cols-3"
          options={[
            {
              value: 'firefox',
              label: t('login.firefoxCookie'),
              hint: t('login.firefoxCookieDescription'),
            },
            {
              value: 'qrCode',
              label: t('login.qrCode'),
              hint: t('login.qrCodeDescription'),
            },
            {
              value: 'manual',
              label: t('login.manualCookie'),
              hint: t('login.manualCookieDescription'),
            },
          ]}
        />
        {loginMethod === 'manual' && (
          <ManualCookieForm
            onApplied={async () => {
              toast.success(t('login.manualCookieApplied'))
              await refreshLoginState()
            }}
          />
        )}
      </SettingField>
      <div className="space-y-3">
        <Label>{t('login.loginStatus')}</Label>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {t(getLoginStatusText(session, loginMethod, user))}
          </span>
          {(loginMethod === 'qrCode' || loginMethod === 'manual') &&
            session && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowLogoutDialog(true)}
              >
                {t('login.logout')}
              </Button>
            )}
        </div>
      </div>

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('login.logoutConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('login.logoutConfirmMessage')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('login.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleLogout}>
              {t('login.logout')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
