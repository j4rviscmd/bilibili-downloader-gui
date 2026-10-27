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
  RestartConfirmDialog,
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
import { relaunch } from '@tauri-apps/plugin-process'
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
  const [draftMethod, setDraftMethod] = useState<LoginMethod | null>(null)
  const [pendingMethod, setPendingMethod] = useState<LoginMethod | null>(null)
  const [restartFailed, setRestartFailed] = useState(false)
  // Cards show the staged draft until it is applied or cancelled; null
  // means "follows the confirmed Redux method".
  const selectedMethod = draftMethod ?? loginMethod

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
   * manual-cookie apply) so the section and AppBar stay consistent. The
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
   * Stages a login-method selection.
   *
   * Card clicks only move the local draft — nothing is persisted and no
   * dialog appears. The restart-confirmation dialog opens from the explicit
   * Apply button instead, so the modal never ambushes a plain selection
   * (this section also hosts the manual-cookie form, making selection-click
   * a poor trigger). The backend stays untouched before confirmation:
   * switching to Firefox deletes the stored session backend-side.
   */
  const handleLoginMethodChange = (value: string) => {
    const next = value as LoginMethod
    setDraftMethod(next === loginMethod ? null : next)
  }

  /** Opens the restart-confirmation dialog for the staged selection. */
  const handleApplyMethod = () => {
    if (!draftMethod) return
    setRestartFailed(false)
    setPendingMethod(draftMethod)
  }

  /**
   * Persists the pending method and relaunches. Cookie caches and
   * login-derived state (session, user, in-flight requests) live in too
   * many places to reset by hand, so every switch — not just Firefox — is
   * applied via relaunch. Persist/relaunch failure stays retryable (and
   * cancellable via the overlay).
   */
  const handleRestart = async () => {
    if (!pendingMethod) return
    try {
      await setLoginMethodApi(pendingMethod)
      // Note: syncing the store and cards looks pointless right before
      // relaunch (success replaces the process) — it exists for the
      // relaunch-failure path, where cancel must keep the persisted
      // switch instead of reverting it (see "cancel after a failed
      // relaunch" in AccountSection.test.tsx).
      store.dispatch(setLoginMethodAction(pendingMethod))
      setDraftMethod(null)
      await relaunch()
    } catch (error) {
      logger.error('Failed to apply login method change', error)
      setRestartFailed(true)
    }
  }

  return (
    <div className="space-y-6">
      <SettingField
        label={t('login.loginMethod')}
        description={t('login.loginMethodDescription')}
      >
        <SettingChoiceCards
          value={selectedMethod}
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
        {/* Apply for firefox/QR only. A staged manual hides it: the cookie
            form's own Apply (which verifies and commits the session AND the
            method) is that method's confirm action — switching to manual
            without a cookie to paste is a useless logged-out state. */}
        {draftMethod !== null &&
          draftMethod !== loginMethod &&
          draftMethod !== 'manual' && (
            <div className="flex justify-end">
              <Button size="sm" onClick={handleApplyMethod}>
                {t('login.applyMethod')}
              </Button>
            </div>
          )}
        {selectedMethod === 'manual' && (
          <ManualCookieForm
            onApplied={async () => {
              toast.success(t('login.manualCookieApplied'))
              await refreshLoginState()
              // A paste from the staged state completes the switch to
              // manual (commit_session persists the method too) — offer
              // the restart that makes it app-wide. Routine re-pastes on
              // an already confirmed manual method are plain re-logins;
              // no dialog for those.
              if (draftMethod === 'manual') {
                setDraftMethod(null)
                setRestartFailed(false)
                setPendingMethod('manual')
              }
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

      {/* Restart-confirmation dialog: cancel (overlay click) reverts the
          staged card selection while nothing is persisted yet — after a
          failed restart attempt the method may already be saved, so cancel
          then only closes the dialog. The no-close-button / no-ESC
          contract lives in RestartConfirmDialog. */}
      <RestartConfirmDialog
        open={pendingMethod !== null}
        onCancel={() => {
          setPendingMethod(null)
          setDraftMethod(null)
        }}
        onConfirm={handleRestart}
        failed={restartFailed}
      />
    </div>
  )
}
