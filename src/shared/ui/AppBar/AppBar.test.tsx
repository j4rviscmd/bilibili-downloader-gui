import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import type { User } from '@/features/user/types'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AppBar from './AppBar'

// Child feature widgets have their own concerns (settings hook, QR polling,
// star fetching); stub them so this suite stays on AppBar's own logic.
vi.mock('@/features/login', () => ({
  QRCodeLoginDialog: ({ open }: { open: boolean }) =>
    open ? <div>qr-login-dialog</div> : null,
}))
vi.mock('@/features/preference/ui/LanguageSwitcher', () => ({
  default: () => <div>language-switcher</div>,
}))
vi.mock('@/features/preference/ui/ToggleThemeButton', () => ({
  default: (props: { theme: string }) => <div>theme-{props.theme}</div>,
}))
vi.mock('@/shared/ui/GitHubStars', () => ({
  GitHubStars: () => <div>github-stars</div>,
}))

/** Builds a User with the login fields the AppBar branches on. */
function createUser(
  overrides: { uname?: string; isLogin?: boolean; hasCookie?: boolean } = {},
): User {
  return {
    code: 0,
    message: '',
    ttl: 0,
    data: {
      uname: overrides.uname ?? '',
      isLogin: overrides.isLogin ?? false,
      wbiImg: { imgUrl: '', subUrl: '' },
    },
    hasCookie: overrides.hasCookie ?? false,
  }
}

const baseSettings: Settings = {
  dlOutputPath: '',
  language: 'en',
  autoRenameDuplicates: true,
  showGithubStars: true,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
  showTaskbarProgress: true,
  flashTaskbarOnComplete: true,
  videoCodecPriority: 'av1First',
  downloadParallelism: 8,
}

/** Renders the AppBar, seeding settings.showGithubStars before render. */
function setup(showGithubStars: boolean, user: User = createUser()) {
  store.dispatch(setSettings({ ...baseSettings, showGithubStars }))
  return renderWithProviders(
    <AppBar user={user} theme="light" setTheme={vi.fn()} />,
  )
}

describe('AppBar', () => {
  it('shows the masked username when logged in', () => {
    setup(
      true,
      createUser({ uname: 'someuser', isLogin: true, hasCookie: true }),
    )

    // Last 3 characters are masked for privacy ("someuser" -> "someu***")
    expect(screen.getByText('someu***')).toBeInTheDocument()
    expect(screen.queryByText('user.not_logged_in')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'login.qrCodeLogin' }),
    ).not.toBeInTheDocument()
  })

  it('masks short usernames entirely', () => {
    setup(true, createUser({ uname: 'abc', isLogin: true, hasCookie: true }))

    expect(screen.getByText('***')).toBeInTheDocument()
  })

  it('shows the login prompt and QR button when logged out', async () => {
    const { user: actor } = setup(true, createUser({ isLogin: false }))

    expect(screen.getByText('user.not_logged_in')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'login.qrCodeLogin' }))
    expect(screen.getByText('qr-login-dialog')).toBeInTheDocument()
  })

  it('treats isLogin without a cookie as logged out', () => {
    setup(true, createUser({ uname: 'ghost', isLogin: true, hasCookie: false }))

    expect(screen.getByText('user.not_logged_in')).toBeInTheDocument()
  })

  it('hides GitHub stars when the setting is off', () => {
    setup(false)

    expect(screen.queryByText('github-stars')).not.toBeInTheDocument()
  })

  it('shows GitHub stars when the setting is on', () => {
    setup(true)

    expect(screen.getByText('github-stars')).toBeInTheDocument()
  })
})
