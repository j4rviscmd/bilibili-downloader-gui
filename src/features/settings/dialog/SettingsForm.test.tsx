/**
 * SettingsForm suite (three-layer strategy — key wiring only).
 *
 * - formSchema validation rules are unit-tested in formSchema.test.ts and
 *   are NOT re-tested here (only the required-path FormMessage wiring).
 * - Sibling API/hook layers are mocked: '@/features/login' (getLoginState
 *   / qrLogout / setLoginMethod), '@/features/user' (useUser) and
 *   '@/features/video' (videoApi reset).
 * - useSettings stays real: assertions go through the seeded singleton
 *   store and the 'set_settings' mockInvoke payload.
 * - Decorative siblings (updater/about/logs/dev sections) are stubbed;
 *   TitleReplacementSettings stays real so its wiring is exercised via
 *   the form too.
 */

import { store } from '@/app/store'
import type { Session } from '@/features/login'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocked sibling layers (hoisted refs so factories stay pure) ---------

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
}))

const videoApiMock = vi.hoisted(() => ({
  // resetApiState() must return a dispatchable plain action
  util: { resetApiState: vi.fn().mockReturnValue({ type: 'videoApi/reset' }) },
}))

vi.mock('@/features/login', () => loginApi)
vi.mock('@/features/user', () => ({
  useUser: () => ({
    user: userHook.user,
    onChangeUser: userHook.onChangeUser,
    getUserInfo: userHook.getUserInfo,
  }),
}))
vi.mock('@/features/video', () => ({ videoApi: videoApiMock }))

// --- Stubbed decorative siblings (each has its own suite) -----------------

vi.mock('@/features/about', () => ({
  AboutDialog: () => <div data-testid="about-dialog" />,
}))
vi.mock('@/features/settings/ui/UpdateCheckButton', () => ({
  UpdateCheckButton: () => <div data-testid="update-check" />,
}))
vi.mock('@/features/settings/ui/ReleaseNotesSection', () => ({
  ReleaseNotesSection: () => <div data-testid="release-notes" />,
}))
vi.mock('@/features/settings/ui/OpenLogsButton', () => ({
  OpenLogsButton: () => <div data-testid="open-logs" />,
}))
vi.mock('@/features/settings/ui/DevOptions', () => ({
  DevOptions: () => <div data-testid="dev-options" />,
}))
vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'
import SettingsForm from './SettingsForm'

const toastSuccess = toast.success as unknown as Mock
const toastInfo = toast.info as unknown as Mock

// --- Fixtures --------------------------------------------------------------

const baseline: Settings = {
  dlOutputPath: '/downloads/out',
  language: 'ja',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

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

/** Returns the latest set_settings payload, or undefined. */
function lastSetSettings(): Settings | undefined {
  const calls = mockInvoke.mock.calls.filter(
    (c: unknown[]) => c[0] === 'set_settings',
  )
  const call = calls[calls.length - 1]
  return call?.[1]?.settings as Settings | undefined
}

function seedSettings(partial: Partial<Settings> = {}) {
  store.dispatch(setSettings({ ...baseline, ...partial }))
  userHook.user = loggedOutUser
  store.dispatch(setUser(loggedOutUser))
}

describe('SettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_current_lib_path') return Promise.resolve('/lib')
      return Promise.resolve(undefined)
    })
    loginApi.getLoginState.mockResolvedValue({
      method: 'firefox',
      session: null,
    })
    loginApi.qrLogout.mockResolvedValue(undefined)
    loginApi.setLoginMethod.mockResolvedValue(undefined)
    seedSettings()
  })

  it('renders with the seeded settings (path input and language radio)', async () => {
    seedSettings()
    renderWithProviders(<SettingsForm />)

    expect(screen.getByDisplayValue('/downloads/out')).toBeInTheDocument()
    // Radix radios render aria-checked on the button element
    expect(
      document.getElementById('lang-ja')?.getAttribute('aria-checked'),
    ).toBe('true')
    // Firefox + logged-out user
    expect(screen.getByText('login.notLoggedIn')).toBeInTheDocument()
    // Login state is fetched on mount
    await waitFor(() => expect(loginApi.getLoginState).toHaveBeenCalled())
    expect(mockInvoke).toHaveBeenCalledWith('get_current_lib_path')
  })

  it('changing the language persists via set_settings', async () => {
    seedSettings()
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(screen.getByLabelText('English'))

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ language: 'en' }),
    )
  })

  it('submitting with an empty path shows the required FormMessage and skips saving', async () => {
    seedSettings({ dlOutputPath: '' })
    renderWithProviders(<SettingsForm />)

    fireEvent.submit(document.querySelector('form')!)

    expect(
      await screen.findByText('validation.path.required'),
    ).toBeInTheDocument()
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'set_settings')).toBe(
      false,
    )
  })

  it('changing the theme persists the new theme', async () => {
    seedSettings()
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(screen.getByLabelText('settings.theme_dark'))

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ theme: 'dark' }),
    )
  })

  it('shows the QR-logged-in status and logout button for an active QR session', async () => {
    loginApi.getLoginState.mockResolvedValue({
      method: 'qrCode',
      session,
    })
    renderWithProviders(<SettingsForm />)

    expect(await screen.findByText('login.qrCodeLoggedIn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'login.logout' })).toBeEnabled()
  })

  it('shows the Firefox-cookie status when the cookie authenticates', async () => {
    userHook.user = loggedInFirefoxUser
    renderWithProviders(<SettingsForm />)

    expect(
      await screen.findByText('login.firefoxCookieLoggedIn'),
    ).toBeInTheDocument()
    // Firefox sessions never offer the QR logout button
    expect(screen.queryByRole('button', { name: 'login.logout' })).toBeNull()
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
    store.dispatch(setUser(loggedInFirefoxUser))
    const { user } = renderWithProviders(<SettingsForm />)

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

  it('switching login method persists it, refreshes state and toasts', async () => {
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(screen.getByLabelText('login.qrCode'))

    await waitFor(() =>
      expect(loginApi.setLoginMethod).toHaveBeenCalledWith('qrCode'),
    )
    // mount fetch + refresh after the switch
    await waitFor(() => expect(loginApi.getLoginState).toHaveBeenCalledTimes(2))
    expect(toastSuccess).toHaveBeenCalledWith('login.loginMethodChanged')
    expect(toastInfo).toHaveBeenCalledWith('login.restartRequired')
  })

  it('adding a title replacement rule persists the expanded list', async () => {
    seedSettings()
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(
      screen.getByRole('button', {
        name: 'settings.title_replacement.add_rule',
      }),
    )

    await waitFor(() =>
      expect(lastSetSettings()?.titleReplacements).toEqual([
        ...defaultRules(),
        { from: '', to: '', enabled: true },
      ]),
    )
    // Video cache is reset so the new rules apply to future fetches
    expect(videoApiMock.util.resetApiState).toHaveBeenCalled()
  })

  it('toggling auto-rename persists it and resets the video cache', async () => {
    seedSettings()
    const { user } = renderWithProviders(<SettingsForm />)

    // The Switch has no htmlFor-linked label; find it as the sibling of the
    // section label container (first switch in the form's settings sections).
    const section = screen
      .getByText('settings.auto_rename_duplicates_label')
      .closest('div.flex.items-center.justify-between')!
    const toggle = section.querySelector('button[role="switch"]')!
    await user.click(toggle as HTMLElement)

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ autoRenameDuplicates: false }),
    )
    expect(videoApiMock.util.resetApiState).toHaveBeenCalled()
  })
})

/** Mirrors DEFAULT_RULES in TitleReplacementSettings (backend defaults). */
function defaultRules() {
  return [
    { from: '/', to: '-', enabled: true },
    { from: ':', to: '_', enabled: true },
    { from: '*', to: 'x', enabled: true },
    { from: '?', to: '', enabled: true },
    { from: '"', to: "'", enabled: true },
    { from: '<', to: '(', enabled: true },
    { from: '>', to: ')', enabled: true },
    { from: '|', to: '-', enabled: true },
  ]
}
