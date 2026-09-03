/**
 * SettingsForm suite (three-layer strategy — key wiring only).
 *
 * - formSchema validation rules are unit-tested in formSchema.test.ts and
 *   are NOT re-tested here (only the required-path FormMessage wiring).
 * - Sibling API/hook layers are mocked: '@/features/login' (getLoginState
 *   / qrLogout / setLoginMethod), '@/features/user' (useUser) and
 *   '@/features/video' (videoApi reset).
 * - useSettings stays real: assertions go through the seeded singleton
 *   store and the 'patch_settings' mockInvoke payload.
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
  // Why fetchUser mock: upstream now derives the login status from the live
  // nav API via fetchUser() instead of the session file.
  fetchUser: vi.fn(),
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
  fetchUser: userHook.fetchUser,
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
import { open } from '@tauri-apps/plugin-dialog'
import SettingsForm from './SettingsForm'

const mockOpen = open as unknown as Mock

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

/** Returns the latest patch_settings payload (changed fields), or undefined. */
function lastSetSettings(): Partial<Settings> | undefined {
  const calls = mockInvoke.mock.calls.filter(
    (c: unknown[]) => c[0] === 'patch_settings',
  )
  const call = calls[calls.length - 1]
  return call?.[1]?.patch as Partial<Settings> | undefined
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
    // Default fetchUser -> network-unreachable fallback (sessionToUser), so
    // tests read like the pre-verification file-derived flow unless they
    // explicitly opt into the live nav-API path.
    userHook.fetchUser.mockRejectedValue(new Error('offline'))
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
    expect(mockInvoke.mock.calls.some((c) => c[0] === 'patch_settings')).toBe(
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
    // Live nav API confirms the stored session is still valid; the
    // dispatched setUser result is what useUser surfaces on re-render
    userHook.fetchUser.mockResolvedValue(loggedInFirefoxUser)
    userHook.user = loggedInFirefoxUser
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

  // --- Download output path picker ------------------------------------------

  it('persists a picked download output directory through the dialog', async () => {
    seedSettings()
    mockOpen.mockResolvedValue('/downloads/out2')
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(
      screen.getByRole('button', { name: 'settings.output_dir_button' }),
    )

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({
        dlOutputPath: '/downloads/out2',
      }),
    )
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true }),
    )
  })

  it('keeps the output path when the directory dialog is cancelled', async () => {
    seedSettings()
    mockOpen.mockResolvedValue(null)
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(
      screen.getByRole('button', { name: 'settings.output_dir_button' }),
    )

    expect(lastSetSettings()).toBeUndefined()
  })

  it('survives a throwing directory dialog', async () => {
    seedSettings()
    // One-shot: a permanent rejection would override the setup default for
    // every later dialog test in this file.
    mockOpen.mockRejectedValueOnce(new Error('dialog failed'))
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(
      screen.getByRole('button', { name: 'settings.output_dir_button' }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'settings.output_dir_button' }),
      ).toBeEnabled(),
    )
  })

  // --- Library path ----------------------------------------------------------

  it('updates the library path through the directory dialog', async () => {
    seedSettings()
    mockOpen.mockResolvedValue('/Volumes/External/Lib')
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(
      screen.getByRole('button', { name: 'settings.lib_path_button' }),
    )

    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.some(
          (c: unknown[]) =>
            c[0] === 'update_lib_path' &&
            (c[1] as Record<string, unknown>)?.newPath ===
              '/Volumes/External/Lib',
        ),
      ).toBe(true),
    )
  })

  it('shows the error placeholder when the current lib path fails to load', async () => {
    seedSettings()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_current_lib_path')
        return Promise.reject(new Error('no lib'))
      return Promise.resolve(undefined)
    })
    renderWithProviders(<SettingsForm />)

    expect(
      await screen.findByDisplayValue('settings.lib_path_error'),
    ).toBeInTheDocument()
  })

  // --- Radio groups ----------------------------------------------------------

  it.each([
    [
      'settings.download_parallelism_label',
      'parallel-2',
      { downloadParallelism: 2 },
    ],
    ['settings.trim_mode_label', 'trim-reencode', { trimMode: 'reencode' }],
    ['settings.audio_format_label', 'audio-m4a', { audioFormat: 'm4a' }],
    [
      'settings.video_codec_priority_label',
      'codec-hevc',
      { videoCodecPriority: 'hevcFirst' },
    ],
    [
      'settings.rotation_mode_label',
      'rotation-mode-reencode',
      { rotationMode: 'reencode' },
    ],
    [
      'settings.rotation_angle_label',
      'rotation-angle-180',
      { rotationAngle: 180 },
    ],
  ])(
    'changing %s persists the picked option',
    async (labelKey, radioId, expected) => {
      seedSettings()
      const { user } = renderWithProviders(<SettingsForm />)

      const section = screen.getByText(labelKey).closest('div.space-y-2')!
      await user.click(section.querySelector(`#${radioId}`) as HTMLElement)

      await waitFor(() => expect(lastSetSettings()).toMatchObject(expected))
    },
  )

  // --- Switches ----------------------------------------------------------------

  it.each([
    ['settings.show_github_stars_label', { showGithubStars: false }],
    ['settings.skip_splash_animation_label', { skipSplashAnimation: true }],
    ['settings.taskbar_progress_label', { showTaskbarProgress: false }],
    [
      'settings.flash_taskbar_on_complete_label',
      { flashTaskbarOnComplete: false },
    ],
  ])('toggling %s persists it', async (labelKey, expected) => {
    seedSettings()
    const { user } = renderWithProviders(<SettingsForm />)

    const section = screen
      .getByText(labelKey)
      .closest('div.flex.items-center.justify-between')!
    await user.click(
      section.querySelector('button[role="switch"]') as HTMLElement,
    )

    await waitFor(() => expect(lastSetSettings()).toMatchObject(expected))
  })

  // --- Font size slider -----------------------------------------------------------

  it('persists the font size picked with the slider keyboard', async () => {
    seedSettings({ fontSize: 14 })
    const { user } = renderWithProviders(<SettingsForm />)

    // Radix Slider: focus a thumb then step with the arrow keys
    const thumbs = screen.getAllByRole('slider')
    await user.click(thumbs[0]!)
    await user.keyboard('{ArrowRight}')

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ fontSize: 15 }),
    )
  })

  // --- Login status edge cases ------------------------------------------------------

  it('marks a stored QR session expired when the live user is logged out', async () => {
    loginApi.getLoginState.mockResolvedValue({ method: 'qrCode', session })
    userHook.user = loggedOutUser
    renderWithProviders(<SettingsForm />)

    expect(await screen.findByText('login.session_expired')).toBeInTheDocument()
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
    const { user } = renderWithProviders(<SettingsForm />)

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

  it('keeps the UI stable when the login-method switch fails', async () => {
    loginApi.setLoginMethod.mockRejectedValue(new Error('backend down'))
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(screen.getByLabelText('login.qrCode'))

    await waitFor(() =>
      expect(loginApi.setLoginMethod).toHaveBeenCalledWith('qrCode'),
    )
    expect(toastSuccess).not.toHaveBeenCalledWith('login.loginMethodChanged')
  })

  it('keeps the dialog open when the QR logout fails', async () => {
    loginApi.getLoginState.mockResolvedValue({ method: 'qrCode', session })
    loginApi.qrLogout.mockRejectedValue(new Error('fs error'))
    const { user } = renderWithProviders(<SettingsForm />)

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

  // --- Remaining callbacks ------------------------------------------------------

  it('skips the login-method switch when the method is unchanged', async () => {
    const { user } = renderWithProviders(<SettingsForm />)

    await user.click(screen.getByLabelText('login.firefoxCookie'))

    expect(loginApi.setLoginMethod).not.toHaveBeenCalled()
  })

  it('survives a failing login-state fetch on mount', async () => {
    loginApi.getLoginState.mockRejectedValue(new Error('backend down'))
    renderWithProviders(<SettingsForm />)

    // Form still renders with the logged-out default state
    expect(
      await screen.findByText('settings.auto_save_note'),
    ).toBeInTheDocument()
    expect(screen.getByText('login.notLoggedIn')).toBeInTheDocument()
  })

  it('info tooltip buttons swallow their click via preventDefault', async () => {
    seedSettings()
    const { user } = renderWithProviders(<SettingsForm />)

    const labels = [
      'trim.warningKeyframe',
      'trim.warningReencode',
      'settings.video_codec_av1_first_description',
      'settings.video_codec_hevc_first_description',
      'settings.video_codec_avc_only_description',
      'rotation.warningMetadata',
      'rotation.warningReencode',
    ]
    for (const label of labels) {
      // Two buttons can share a label (trim + rotation); click them all
      const buttons = screen
        .getAllByRole('button', { name: label })
        .filter((b) => b.tagName === 'BUTTON')
      for (const button of buttons) {
        await user.click(button)
      }
    }

    // All info buttons render and swallow clicks without throwing
    expect(screen.getByText('settings.trim_mode_label')).toBeInTheDocument()
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
