/**
 * AccountSection suite (three-layer strategy — key wiring only).
 *
 * - Sibling API/hook layers are mocked: '@/features/login'
 *   (getLoginState / qrLogout / setLoginMethod) and '@/features/user'
 *   (useUser / fetchUser).
 * - The section is mounted per category entry, so the mount fetch and the
 *   login flows (logout, method switch, manual cookie) are exercised here.
 */

import { store } from '@/app/store'
import type { Session } from '@/features/login'
import type { User } from '@/features/user'
import { setUser } from '@/features/user/userSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { relaunch } from '@tauri-apps/plugin-process'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loginApi = vi.hoisted(() => ({
  getLoginState: vi
    .fn()
    .mockResolvedValue({ method: 'firefox', session: null }),
  qrLogout: vi.fn().mockResolvedValue(undefined),
  setLoginMethod: vi.fn().mockResolvedValue(undefined),
}))

const userHook = vi.hoisted(() => ({
  user: null as User | null,
  onChangeUser: vi.fn(),
  getUserInfo: vi.fn().mockResolvedValue(undefined),
  // Why fetchUser mock: the section derives the login status from the live
  // nav API via fetchUser() instead of the session file.
  fetchUser: vi.fn(),
}))

vi.mock('@/features/login', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/login')>()
  return {
    ...actual,
    // Pure helpers (getLoginStatusText / sessionToUser) stay real — they
    // have their own suite; only the IO functions are mocked.
    getLoginState: loginApi.getLoginState,
    qrLogout: loginApi.qrLogout,
    setLoginMethod: loginApi.setLoginMethod,
    // Exposes onApplied so tests can drive the form's Apply flow
    ManualCookieForm: ({ onApplied }: { onApplied?: () => void }) => (
      <div data-testid="manual-cookie-form">
        <button type="button" onClick={onApplied}>
          form-apply
        </button>
      </div>
    ),
  }
})
vi.mock('@/features/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/user')>()),
  useUser: () => ({
    user: userHook.user,
    onChangeUser: userHook.onChangeUser,
    getUserInfo: userHook.getUserInfo,
  }),
  fetchUser: userHook.fetchUser,
}))
vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { setLoginMethodAction, setSession } from '@/features/login'
import { toast } from '@/shared/ui/toast'
import { AccountSection } from './AccountSection'

const toastSuccess = toast.success as unknown as Mock
const toastInfo = toast.info as unknown as Mock

const session: Session = {
  sessdata: 'sess',
  biliJct: 'jct',
  dedeUserId: '42',
  dedeUserIdCkMd5: 'md5',
  refreshToken: 'rt',
  timestamp: 1,
  uname: 'qr-user',
}

const loggedInFirefoxUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: {
    mid: 7,
    uname: 'ff-user',
    isLogin: true,
    wbiImg: { imgUrl: '', subUrl: '' },
  },
  hasCookie: true,
}

const loggedOutUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

/** Login-method card located via its visible label text. */
function methodCard(labelKey: string): HTMLElement {
  return screen.getByText(labelKey).closest('button[aria-pressed]')!
}

/** Stages a switch (card + Apply) and clicks restart in the dialog. */
async function switchMethodAndRestart(user: UserEvent, cardKey: string) {
  await user.click(methodCard(cardKey))
  await user.click(screen.getByRole('button', { name: 'login.applyMethod' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'login.restartNow' }),
  )
  return dialog
}

describe('AccountSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    loginApi.getLoginState.mockResolvedValue({
      method: 'firefox',
      session: null,
    })
    loginApi.qrLogout.mockResolvedValue(undefined)
    loginApi.setLoginMethod.mockResolvedValue(undefined)
    // Default fetchUser -> network-unreachable fallback (sessionToUser), so
    // tests read like the pre-verification file-derived flow unless they
    // explicitly opt into the live nav-API path.
    userHook.fetchUser.mockRejectedValue(new Error('offline'))
    userHook.user = loggedOutUser
    store.dispatch(setUser(loggedOutUser))
    // Reset the login slice to the init-hydrated firefox default
    store.dispatch(setLoginMethodAction('firefox'))
    store.dispatch(setSession(null))
  })

  it('renders the store-hydrated method on first paint, before the mount fetch lands', async () => {
    // Regression: the selection must never flash the firefox default when
    // the store was hydrated (app init) with the persisted method.
    store.dispatch(setLoginMethodAction('qrCode'))
    store.dispatch(setSession(session))
    // Mount fetch never resolves — first paint must come from the store
    loginApi.getLoginState.mockReturnValue(new Promise(() => {}) as never)
    userHook.user = loggedInFirefoxUser

    renderWithProviders(<AccountSection />)

    expect(methodCard('login.qrCode').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('login.qrCodeLoggedIn')).toBeInTheDocument()
  })

  it('renders with the logged-out default and fetches login state on mount', async () => {
    renderWithProviders(<AccountSection />)

    expect(screen.getByText('login.notLoggedIn')).toBeInTheDocument()
    await waitFor(() => expect(loginApi.getLoginState).toHaveBeenCalled())
  })

  it('survives a failing login-state fetch on mount', async () => {
    loginApi.getLoginState.mockRejectedValue(new Error('backend down'))
    renderWithProviders(<AccountSection />)

    // Section still renders with the logged-out default state
    expect(
      await waitFor(() => screen.getByText('login.notLoggedIn')),
    ).toBeInTheDocument()
  })

  it('shows the QR-logged-in status and logout button for an active QR session', async () => {
    loginApi.getLoginState.mockResolvedValue({
      method: 'qrCode',
      session,
    })
    // Live nav API confirms the stored session is still valid; the
    // dispatched setUser result is what useUser surfaces on re-render
    userHook.fetchUser.mockResolvedValue(loggedInFirefoxUser)
    userHook.user = loggedInFirefoxUser
    renderWithProviders(<AccountSection />)

    expect(await screen.findByText('login.qrCodeLoggedIn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'login.logout' })).toBeEnabled()
  })

  it('shows the Firefox-cookie status when the cookie authenticates', async () => {
    userHook.user = loggedInFirefoxUser
    renderWithProviders(<AccountSection />)

    expect(
      await screen.findByText('login.firefoxCookieLoggedIn'),
    ).toBeInTheDocument()
    // Firefox sessions never offer the QR logout button
    expect(screen.queryByRole('button', { name: 'login.logout' })).toBeNull()
  })

  it('marks a stored QR session expired when the live user is logged out', async () => {
    loginApi.getLoginState.mockResolvedValue({ method: 'qrCode', session })
    userHook.user = loggedOutUser
    renderWithProviders(<AccountSection />)

    expect(await screen.findByText('login.session_expired')).toBeInTheDocument()
  })

  it('logout confirms, calls qrLogout and resets the user slice', async () => {
    loginApi.getLoginState.mockResolvedValueOnce({
      method: 'qrCode',
      session,
    })
    loginApi.getLoginState.mockResolvedValue({
      method: 'qrCode',
      session: null,
    })
    userHook.user = loggedInFirefoxUser
    store.dispatch(setUser(loggedInFirefoxUser))
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(
      await screen.findByRole('button', { name: 'login.logout' }),
    )
    // Confirmation dialog: the AlertDialogAction is the last matching button
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'login.logout' }),
    )

    await waitFor(() => expect(loginApi.qrLogout).toHaveBeenCalledTimes(1))
    expect(toastSuccess).toHaveBeenCalledWith('login.qrSessionDeleted')
    // refreshLoginState dispatched the logged-out user derived from session=null
    expect(store.getState().user.data.isLogin).toBe(false)
    expect(store.getState().user.hasCookie).toBe(false)
  })

  it('hints at the Firefox fallback after logging out of a shared session', async () => {
    loginApi.getLoginState.mockResolvedValueOnce({
      method: 'qrCode',
      session,
    })
    // After the QR session is deleted, a Firefox session file remains
    loginApi.getLoginState.mockResolvedValue({
      method: 'firefox',
      session,
    })
    // Live nav API answers, so refreshLoginState dispatches the live user
    userHook.fetchUser.mockResolvedValue(loggedInFirefoxUser)
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(
      await screen.findByRole('button', { name: 'login.logout' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'login.logout' }),
    )

    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith('login.usingFirefoxCookie'),
    )
  })

  it('keeps the section stable when the QR logout fails', async () => {
    loginApi.getLoginState.mockResolvedValue({ method: 'qrCode', session })
    userHook.user = loggedInFirefoxUser
    loginApi.qrLogout.mockRejectedValue(new Error('fs error'))
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(
      await screen.findByRole('button', { name: 'login.logout' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'login.logout' }),
    )

    await waitFor(() => expect(loginApi.qrLogout).toHaveBeenCalledTimes(1))
    expect(toastSuccess).not.toHaveBeenCalledWith('login.qrSessionDeleted')
  })

  it('a card click only stages the selection; Apply opens the dialog', async () => {
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.qrCode'))

    // Staged only: the card is visually selected and Apply is offered,
    // but nothing is persisted and no dialog appears yet
    expect(methodCard('login.qrCode').getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.getByRole('button', { name: 'login.applyMethod' }),
    ).toBeEnabled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(loginApi.setLoginMethod).not.toHaveBeenCalled()
    expect(store.getState().login.loginMethod).toBe('firefox')

    await user.click(screen.getByRole('button', { name: 'login.applyMethod' }))

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('login.restartRequiredTitle'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('login.restartRequired'),
    ).toBeInTheDocument()
    // Still nothing persisted — restart confirms
    expect(loginApi.setLoginMethod).not.toHaveBeenCalled()
    // No error shown before any restart attempt
    expect(within(dialog).queryByRole('alert')).toBeNull()
    // ESC stays disabled — cancel is overlay-click only, by design
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // No X / cancel affordances — the restart button is the only button
    expect(within(dialog).getAllByRole('button')).toHaveLength(1)
  })

  it('staging QR offers the section Apply; staging manual shows the form instead', async () => {
    const { user } = renderWithProviders(<AccountSection />)

    // Manual staging: the cookie form replaces the section Apply button
    await user.click(methodCard('login.manualCookie'))
    expect(await screen.findByTestId('manual-cookie-form')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'login.applyMethod' }),
    ).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    // QR staging keeps the section Apply button
    await user.click(methodCard('login.qrCode'))
    expect(screen.queryByTestId('manual-cookie-form')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'login.applyMethod' }),
    ).toBeInTheDocument()
  })

  it('an overlay click cancels the switch and reverts the selection', async () => {
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.qrCode'))
    await user.click(screen.getByRole('button', { name: 'login.applyMethod' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    // Clicking the overlay (not body — Radix sets pointer-events:none on
    // body while the dialog is open) dismisses it
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    await user.click(overlay as HTMLElement)

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    // Cancel reverts the staged selection with it: no Apply button, the
    // confirmed card stays selected, nothing persisted
    expect(
      screen.queryByRole('button', { name: 'login.applyMethod' }),
    ).toBeNull()
    expect(methodCard('login.firefoxCookie').getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(loginApi.setLoginMethod).not.toHaveBeenCalled()
    expect(store.getState().login.loginMethod).toBe('firefox')
  })

  it('the restart button persists the method and relaunches the app', async () => {
    const { user } = renderWithProviders(<AccountSection />)

    await switchMethodAndRestart(user, 'login.qrCode')

    await waitFor(() =>
      expect(loginApi.setLoginMethod).toHaveBeenCalledWith('qrCode'),
    )
    expect(store.getState().login.loginMethod).toBe('qrCode')
    await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1))
  })

  it('shows an error and allows retry when the relaunch fails', async () => {
    vi.mocked(relaunch).mockRejectedValueOnce(new Error('nope'))
    const { user } = renderWithProviders(<AccountSection />)

    const dialog = await switchMethodAndRestart(user, 'login.qrCode')

    // role="alert" announces the failure to screen readers
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'login.restartFailed',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'login.restartNow' }),
    )
    await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(2))
  })

  it('shows an error and stays cancelable when the persist step fails', async () => {
    loginApi.setLoginMethod.mockRejectedValue(new Error('backend down'))
    const { user } = renderWithProviders(<AccountSection />)

    const dialog = await switchMethodAndRestart(user, 'login.qrCode')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'login.restartFailed',
    )
    expect(relaunch).not.toHaveBeenCalled()
    // The overlay cancel remains available on failure
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    await user.click(overlay as HTMLElement)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(store.getState().login.loginMethod).toBe('firefox')
  })

  it('cancel after a failed relaunch keeps the already-persisted method', async () => {
    // Persist succeeds, relaunch fails: the switch is saved and dispatched
    // before the failure, so cancel only closes the dialog — unlike the
    // pre-attempt cancel it must not revert the selection
    vi.mocked(relaunch).mockRejectedValueOnce(new Error('nope'))
    const { user } = renderWithProviders(<AccountSection />)

    const dialog = await switchMethodAndRestart(user, 'login.qrCode')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'login.restartFailed',
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    await user.click(overlay as HTMLElement)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    // The saved switch stands: the card follows the store, no re-Apply
    expect(store.getState().login.loginMethod).toBe('qrCode')
    expect(methodCard('login.qrCode').getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.queryByRole('button', { name: 'login.applyMethod' }),
    ).toBeNull()
  })

  it('clears the stale failure error when the dialog is reopened after a cancel', async () => {
    loginApi.setLoginMethod.mockRejectedValueOnce(new Error('backend down'))
    const { user } = renderWithProviders(<AccountSection />)

    // Fail once, then cancel via the overlay
    const dialog = await switchMethodAndRestart(user, 'login.qrCode')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'login.restartFailed',
    )
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    await user.click(overlay as HTMLElement)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )

    // Re-staging and re-applying must not resurrect the old error
    await user.click(methodCard('login.qrCode'))
    await user.click(screen.getByRole('button', { name: 'login.applyMethod' }))
    const reopened = await screen.findByRole('dialog')
    expect(within(reopened).queryByRole('alert')).toBeNull()
  })

  it('re-staging the confirmed method drops the Apply button', async () => {
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.qrCode'))
    expect(
      screen.getByRole('button', { name: 'login.applyMethod' }),
    ).toBeInTheDocument()

    // Back to the confirmed method — nothing left to apply
    await user.click(methodCard('login.firefoxCookie'))
    expect(
      screen.queryByRole('button', { name: 'login.applyMethod' }),
    ).toBeNull()
    expect(loginApi.setLoginMethod).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('skips the login-method switch when the method is unchanged', async () => {
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.firefoxCookie'))

    expect(loginApi.setLoginMethod).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'login.applyMethod' }),
    ).toBeNull()
  })

  it('a staged manual cookie apply opens the restart dialog and confirm relaunches', async () => {
    // Mount reports firefox (the confirmed method); only AFTER the form's
    // Apply has the backend committed the session AND the manual method,
    // so the refresh fetch reports manual.
    loginApi.getLoginState
      .mockResolvedValueOnce({ method: 'firefox', session: null })
      .mockResolvedValue({ method: 'manual', session: null })
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.manualCookie'))
    await user.click(
      within(screen.getByTestId('manual-cookie-form')).getByRole('button'),
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'login.restartNow' }))
    await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1))
  })

  it('a routine re-paste on confirmed manual does not reopen the dialog', async () => {
    loginApi.getLoginState.mockResolvedValue({
      method: 'manual',
      session: null,
    })
    store.dispatch(setLoginMethodAction('manual'))
    const { user } = renderWithProviders(<AccountSection />)

    expect(await screen.findByTestId('manual-cookie-form')).toBeInTheDocument()
    await user.click(
      within(screen.getByTestId('manual-cookie-form')).getByRole('button'),
    )

    expect(toastSuccess).toHaveBeenCalledWith('login.manualCookieApplied')
    await waitFor(() =>
      expect(store.getState().login.loginMethod).toBe('manual'),
    )
    // Re-login, not a method switch — no restart prompt
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(relaunch).not.toHaveBeenCalled()
  })
})
