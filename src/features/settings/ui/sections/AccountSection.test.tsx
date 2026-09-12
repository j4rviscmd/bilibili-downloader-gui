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
import { screen, waitFor, within } from '@testing-library/react'
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
    ManualCookieForm: () => <div data-testid="manual-cookie-form" />,
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

  it('switching to firefox persists it, refreshes state and toasts restart', async () => {
    // Mount as QR (the shared mock defaults to firefox), then switch to
    // firefox so the restart toasts fire.
    loginApi.getLoginState.mockResolvedValueOnce({
      method: 'qrCode',
      session: null,
    })
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.firefoxCookie'))

    await waitFor(() =>
      expect(loginApi.setLoginMethod).toHaveBeenCalledWith('firefox'),
    )
    expect(toastSuccess).toHaveBeenCalledWith('login.loginMethodChanged')
    expect(toastInfo).toHaveBeenCalledWith('login.restartRequired')
  })

  it('switching to manual or QR stays silent; the login action itself is the feedback', async () => {
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.manualCookie'))
    await waitFor(() =>
      expect(loginApi.setLoginMethod).toHaveBeenCalledWith('manual'),
    )
    await user.click(methodCard('login.qrCode'))
    await waitFor(() =>
      expect(loginApi.setLoginMethod).toHaveBeenCalledWith('qrCode'),
    )
    // No "method changed"/"restart required" toasts for QR/Manual: QR scan
    // and cookie paste both log in live without a restart.
    expect(toastSuccess).not.toHaveBeenCalledWith('login.loginMethodChanged')
    expect(toastInfo).not.toHaveBeenCalledWith('login.restartRequired')
  })

  it('keeps the UI stable when the login-method switch fails', async () => {
    loginApi.setLoginMethod.mockRejectedValue(new Error('backend down'))
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.qrCode'))

    await waitFor(() =>
      expect(loginApi.setLoginMethod).toHaveBeenCalledWith('qrCode'),
    )
    expect(toastSuccess).not.toHaveBeenCalledWith('login.loginMethodChanged')
  })

  it('skips the login-method switch when the method is unchanged', async () => {
    const { user } = renderWithProviders(<AccountSection />)

    await user.click(methodCard('login.firefoxCookie'))

    expect(loginApi.setLoginMethod).not.toHaveBeenCalled()
  })

  it('shows the manual cookie form only for the manual method', async () => {
    // Mount as firefox, then the post-switch refresh reports manual
    // (refreshLoginState re-reads the method and would flip it back).
    loginApi.getLoginState.mockResolvedValueOnce({
      method: 'firefox',
      session: null,
    })
    loginApi.getLoginState.mockResolvedValue({
      method: 'manual',
      session: null,
    })
    const { user } = renderWithProviders(<AccountSection />)

    expect(screen.queryByTestId('manual-cookie-form')).toBeNull()

    await user.click(methodCard('login.manualCookie'))

    expect(await screen.findByTestId('manual-cookie-form')).toBeInTheDocument()
  })
})
