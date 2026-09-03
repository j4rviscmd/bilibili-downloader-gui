/**
 * DevOptions suite.
 *
 * useUser is mocked at the hook level (its behavior is covered by the F3
 * hook suite); the settings flow runs against the real store + mockInvoke.
 * The component renders only when import.meta.env.DEV is true, which is
 * the Vitest default.
 */

import { store } from '@/app/store'
import { setSimulateLogout } from '@/features/settings/devSlice'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock factories may only reference hoisted bindings: keep the spies and
// the live user snapshot here, refreshed in beforeEach.
const userHook = vi.hoisted(() => ({
  onChangeUser: vi.fn(),
  getUserInfo: vi.fn().mockResolvedValue(undefined),
  user: null as User | null,
}))

vi.mock('@/features/user', () => ({
  useUser: () => ({
    user: userHook.user,
    onChangeUser: userHook.onChangeUser,
    getUserInfo: userHook.getUserInfo,
  }),
}))

import { DevOptions } from './DevOptions'

const baseline: Settings = {
  dlOutputPath: '/downloads',
  language: 'en',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
  openDevtoolsOnStartup: true,
}

const loggedInUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: {
    mid: 42,
    uname: 'bilibili-user',
    isLogin: true,
    wbiImg: { imgUrl: '', subUrl: '' },
  },
  hasCookie: true,
}

/** Switches carry stable ids; Radix renders them as role="switch" buttons. */
function switchById(id: string): HTMLElement {
  const el = document.getElementById(id)
  expect(el, `expected switch #${id}`).toBeTruthy()
  return el as HTMLElement
}

describe('DevOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setUser(loggedInUser))
    userHook.user = loggedInUser
    store.dispatch(setSimulateLogout(false))
    store.dispatch(setSettings(baseline))
  })

  it('hides options until the collapsible trigger is opened', async () => {
    const { user } = renderWithProviders(<DevOptions />)

    expect(
      screen.queryByText('settings.dev_options.simulate_logout'),
    ).toBeNull()

    await user.click(screen.getByText('settings.dev_options.title'))

    expect(
      screen.getByText('settings.dev_options.simulate_logout'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('settings.dev_options.open_devtools_on_startup'),
    ).toBeInTheDocument()
  })

  it('toggling simulate-logout on invokes the backend, flags dev state and replaces the user', async () => {
    const { user } = renderWithProviders(<DevOptions />)
    await user.click(screen.getByText('settings.dev_options.title'))

    await user.click(switchById('simulate-logout'))

    expect(mockInvoke).toHaveBeenCalledWith('set_simulate_logout', {
      enabled: true,
    })
    expect(store.getState().dev.simulateLogout).toBe(true)
    // The logged-in user is replaced with a logged-out stub.
    const dispatched = userHook.onChangeUser.mock.calls[0][0] as User
    expect(dispatched.data.isLogin).toBe(false)
    expect(dispatched.hasCookie).toBe(false)
    expect(userHook.getUserInfo).not.toHaveBeenCalled()
  })

  it('toggling simulate-logout off restores the real user via getUserInfo', async () => {
    store.dispatch(setSimulateLogout(true))
    const { user } = renderWithProviders(<DevOptions />)
    await user.click(screen.getByText('settings.dev_options.title'))

    await user.click(switchById('simulate-logout'))

    expect(mockInvoke).toHaveBeenCalledWith('set_simulate_logout', {
      enabled: false,
    })
    expect(store.getState().dev.simulateLogout).toBe(false)
    expect(userHook.getUserInfo).toHaveBeenCalledTimes(1)
  })

  it('toggling devtools persists openDevtoolsOnStartup via set_settings', async () => {
    const { user } = renderWithProviders(<DevOptions />)
    await user.click(screen.getByText('settings.dev_options.title'))

    await user.click(switchById('open-devtools-on-startup'))

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: { openDevtoolsOnStartup: false },
    })
  })
})
