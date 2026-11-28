import { store } from '@/app/store'
import {
  setFirefoxAccessDenied,
  setFirefoxPermissionDismissed,
} from '@/features/init/model/initSlice'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { act, screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FirefoxPermissionDialog } from './FirefoxPermissionDialog'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const toastError = toast.error as unknown as Mock
const toastSuccess = toast.success as unknown as Mock

const loggedOutUser = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

const loggedInUser = {
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

describe('FirefoxPermissionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setFirefoxAccessDenied(false))
    store.dispatch(setFirefoxPermissionDismissed(false))
  })

  it('renders nothing while Firefox access is allowed', () => {
    renderWithProviders(<FirefoxPermissionDialog />)

    expect(screen.queryByText('login.firefoxPermissionTitle')).toBeNull()
  })

  it('shows the steps and three actions while access is denied', () => {
    store.dispatch(setFirefoxAccessDenied(true))

    renderWithProviders(<FirefoxPermissionDialog />)

    expect(screen.getByText('login.firefoxPermissionTitle')).toBeInTheDocument()
    expect(
      screen.getByText('login.firefoxPermissionStepNotification'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('login.firefoxPermissionStepSettings'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('login.firefoxPermissionStepRetry'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'actions.close' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'login.firefoxPermissionRetry' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'login.firefoxPermissionOpenSettings',
      }),
    ).toBeInTheDocument()
  })

  it('opens System Settings from the primary action', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(
      screen.getByRole('button', {
        name: 'login.firefoxPermissionOpenSettings',
      }),
    )

    expect(mockInvoke).toHaveBeenCalledWith('open_macos_privacy_settings')
    expect(store.getState().init.firefoxAccessDenied).toBe(true)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts when System Settings cannot be opened', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({
      open_macos_privacy_settings: new Error('no handler for the URL scheme'),
    })
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(
      screen.getByRole('button', {
        name: 'login.firefoxPermissionOpenSettings',
      }),
    )

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'login.firefoxPermissionOpenFailed',
      ),
    )
  })

  it('reloads the cookies, refreshes the user and closes when retry succeeds', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({ get_cookie: 'loaded', fetch_user: loggedInUser })
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionRetry' }),
    )

    await waitFor(() =>
      expect(store.getState().init.firefoxAccessDenied).toBe(false),
    )
    expect(mockInvoke).toHaveBeenCalledWith('get_cookie')
    expect(mockInvoke).toHaveBeenCalledWith('fetch_user')
    expect(store.getState().user.data.uname).toBe('tester')
    expect(toastSuccess).toHaveBeenCalledWith('login.firefoxPermissionLoaded')
  })

  it('reports readable cookies without a bilibili login instead of claiming success', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({ get_cookie: 'loaded', fetch_user: loggedOutUser })
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionRetry' }),
    )

    await waitFor(() =>
      expect(store.getState().init.firefoxAccessDenied).toBe(false),
    )
    expect(toastError).toHaveBeenCalledWith('login.firefoxPermissionNoCookies')
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('toasts and stays open when the reload itself fails', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({ get_cookie: new Error('sqlite read error') })
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionRetry' }),
    )

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'login.firefoxPermissionRetryFailed',
      ),
    )
    expect(store.getState().init.firefoxAccessDenied).toBe(true)
  })

  it('stays open with an error while access is still denied', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({ get_cookie: 'accessDenied' })
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionRetry' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'login.firefoxPermissionStillDenied',
    )
    expect(store.getState().init.firefoxAccessDenied).toBe(true)
    expect(mockInvoke).not.toHaveBeenCalledWith('fetch_user')
    expect(toastError).toHaveBeenCalledWith(
      'login.firefoxPermissionStillDenied',
    )
  })

  it('reports when Firefox holds no bilibili login', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({ get_cookie: 'noCookies' })
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionRetry' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'login.firefoxPermissionNoCookies',
    )
    expect(store.getState().init.firefoxAccessDenied).toBe(true)
  })

  it('dismisses for the session when closed', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(screen.getByRole('button', { name: 'actions.close' }))

    expect(store.getState().init.firefoxAccessDenied).toBe(true)
    expect(store.getState().init.firefoxPermissionDismissed).toBe(true)
  })

  it('clears a previous retry error when reopened', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    mockCommands({ get_cookie: 'accessDenied' })
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionRetry' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'login.firefoxPermissionStillDenied',
    )

    await user.click(screen.getByRole('button', { name: 'actions.close' }))
    act(() => {
      store.dispatch(setFirefoxPermissionDismissed(false))
    })

    expect(screen.getByText('login.firefoxPermissionTitle')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disables Retry while the reload is in flight', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    let finishReload!: (outcome: string) => void
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'get_cookie'
        ? new Promise<string>((resolve) => {
            finishReload = resolve
          })
        : Promise.resolve(undefined),
    )
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)
    const retry = () =>
      screen.getByRole('button', { name: 'login.firefoxPermissionRetry' })

    await user.click(retry())

    expect(retry()).toBeDisabled()

    finishReload('noCookies')
    await waitFor(() => expect(retry()).toBeEnabled())
  })

  it('dismisses when closed with Escape', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.keyboard('{Escape}')

    expect(store.getState().init.firefoxAccessDenied).toBe(true)
    expect(store.getState().init.firefoxPermissionDismissed).toBe(true)
  })

  it('dismisses when closed by clicking the overlay', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    const { user } = renderWithProviders(<FirefoxPermissionDialog />)

    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)

    await waitFor(() =>
      expect(store.getState().init.firefoxPermissionDismissed).toBe(true),
    )
    expect(store.getState().init.firefoxAccessDenied).toBe(true)
  })

  it('stays hidden while the denial is dismissed for the session', () => {
    store.dispatch(setFirefoxAccessDenied(true))
    store.dispatch(setFirefoxPermissionDismissed(true))

    renderWithProviders(<FirefoxPermissionDialog />)

    expect(screen.queryByText('login.firefoxPermissionTitle')).toBeNull()
  })
})
