import { store } from '@/app/store'
import {
  setFirefoxAccessDenied,
  setFirefoxPermissionDismissed,
} from '@/features/init/model/initSlice'
import { setLoginMethod as setLoginMethodAction } from '@/features/login/model/loginSlice'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FirefoxPermissionNotice } from './FirefoxPermissionNotice'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const toastError = toast.error as unknown as Mock
const toastSuccess = toast.success as unknown as Mock

const loggedOutUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

const loggedInUser: User = {
  code: 0,
  message: '',
  ttl: 1,
  data: { uname: 'tester', isLogin: true, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: true,
}

function mockCommands(handlers: Record<string, unknown>) {
  mockInvoke.mockImplementation((cmd: string) => {
    const handler = handlers[cmd]
    if (handler instanceof Error) return Promise.reject(handler)
    if (handler !== undefined) return Promise.resolve(handler)
    return Promise.resolve(undefined)
  })
}

describe('FirefoxPermissionNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setFirefoxAccessDenied(false))
    store.dispatch(setFirefoxPermissionDismissed(false))
    store.dispatch(setLoginMethodAction('firefox'))
    store.dispatch(setUser(loggedOutUser))
  })

  it('renders nothing when access was not denied', () => {
    renderWithProviders(<FirefoxPermissionNotice />)

    expect(screen.queryByText('login.firefoxPermissionNotice')).toBeNull()
  })

  it('renders nothing when the login method is not Firefox', () => {
    store.dispatch(setFirefoxAccessDenied(true))
    store.dispatch(setLoginMethodAction('qrCode'))

    renderWithProviders(<FirefoxPermissionNotice />)

    expect(screen.queryByText('login.firefoxPermissionNotice')).toBeNull()
  })

  it('renders nothing when the user is already logged in', () => {
    store.dispatch(setFirefoxAccessDenied(true))
    store.dispatch(setUser(loggedInUser))

    renderWithProviders(<FirefoxPermissionNotice />)

    expect(screen.queryByText('login.firefoxPermissionNotice')).toBeNull()
  })

  it('shows the notice and action while Firefox access is denied', () => {
    store.dispatch(setFirefoxAccessDenied(true))

    renderWithProviders(<FirefoxPermissionNotice />)

    expect(
      screen.getByText('login.firefoxPermissionNotice'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'login.firefoxPermissionCheck' }),
    ).toBeInTheDocument()
  })

  it('reopens the dialog when the permission is still denied', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    store.dispatch(setFirefoxPermissionDismissed(true))
    mockCommands({ get_cookie: 'accessDenied' })
    const { user } = renderWithProviders(<FirefoxPermissionNotice />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionCheck' }),
    )

    await waitFor(() =>
      expect(store.getState().init.firefoxPermissionDismissed).toBe(false),
    )
    expect(mockInvoke).not.toHaveBeenCalledWith('fetch_user')
    expect(store.getState().init.firefoxAccessDenied).toBe(true)
  })

  it('logs in and clears the denial when the permission was granted', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    const onResolved = vi.fn()
    mockCommands({ get_cookie: 'loaded', fetch_user: loggedInUser })
    const { user } = renderWithProviders(
      <FirefoxPermissionNotice onResolved={onResolved} />,
    )

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionCheck' }),
    )

    await waitFor(() =>
      expect(store.getState().init.firefoxAccessDenied).toBe(false),
    )
    expect(mockInvoke).toHaveBeenCalledWith('fetch_user')
    expect(store.getState().user.data.uname).toBe('tester')
    expect(toastSuccess).toHaveBeenCalledWith('login.firefoxPermissionLoaded')
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('login.firefoxPermissionNotice')).toBeNull()
  })

  it('reports readable cookies without a bilibili login instead of claiming success', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    const onResolved = vi.fn()
    mockCommands({ get_cookie: 'loaded', fetch_user: loggedOutUser })
    const { user } = renderWithProviders(
      <FirefoxPermissionNotice onResolved={onResolved} />,
    )

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionCheck' }),
    )

    await waitFor(() =>
      expect(store.getState().init.firefoxAccessDenied).toBe(false),
    )
    expect(toastError).toHaveBeenCalledWith('login.firefoxPermissionNoCookies')
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('reports when Firefox holds no bilibili login', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({ get_cookie: 'noCookies' })
    const { user } = renderWithProviders(<FirefoxPermissionNotice />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionCheck' }),
    )

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'login.firefoxPermissionNoCookies',
      ),
    )
    expect(store.getState().init.firefoxAccessDenied).toBe(true)
  })

  it('disables the check while the permission check is in flight', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    let finishCheck!: (outcome: string) => void
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'get_cookie'
        ? new Promise<string>((resolve) => {
            finishCheck = resolve
          })
        : Promise.resolve(undefined),
    )
    const { user } = renderWithProviders(<FirefoxPermissionNotice />)
    const check = () =>
      screen.getByRole('button', { name: 'login.firefoxPermissionCheck' })

    await user.click(check())

    expect(check()).toBeDisabled()

    finishCheck('noCookies')
    await waitFor(() => expect(check()).toBeEnabled())
  })

  it('reports a failed check instead of failing silently', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({ get_cookie: new Error('sqlite read error') })
    const { user } = renderWithProviders(<FirefoxPermissionNotice />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionCheck' }),
    )

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'login.firefoxPermissionRetryFailed',
      ),
    )
  })
})
