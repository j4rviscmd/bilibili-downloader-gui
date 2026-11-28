/**
 * QRCodeLoginDialog suite.
 *
 * QRCodeDisplay has its own suite; it is stubbed here so this file covers
 * only the dialog contract: mounts the display while open, unmounts on
 * close (stopping polling), and closes itself on login success.
 */

import { store } from '@/app/store'
import { setFirefoxAccessDenied } from '@/features/init/model/initSlice'
import { setLoginMethod } from '@/features/login/model/loginSlice'
import { setUser } from '@/features/user/userSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
// Why: DialogContent exits through motion's AnimatePresence, which keeps
// children mounted until the exit animation ends — the closed-dialog
// assertions below would still find qr-display; children-only makes the
// unmount synchronous (src/shared/animate-ui/radix/dialog.tsx)
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('./FirefoxCookiePanel', () => ({
  FirefoxCookiePanel: () => <div data-testid="firefox-panel" />,
}))
vi.mock('./QRCodeDisplay', () => ({
  QRCodeDisplay: ({ onSuccess }: { onSuccess?: () => void }) => (
    <div>
      <span data-testid="qr-display" />
      <button type="button" onClick={onSuccess}>
        simulate-success
      </button>
    </div>
  ),
}))

import QRCodeLoginDialog from './QRCodeLoginDialog'

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

// Why: rerender swaps the whole tree including renderWithProviders'
// wrapper (real store + MemoryRouter), so subsequent renders must re-wrap
// by hand (src/test/test-utils.tsx)
const wrap = (ui: ReactNode) => (
  <Provider store={store}>
    <MemoryRouter>{ui}</MemoryRouter>
  </Provider>
)

describe('QRCodeLoginDialog', () => {
  let onOpenChange: (open: boolean) => void

  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setFirefoxAccessDenied(false))
    store.dispatch(setUser(loggedOutUser))
    store.dispatch(setLoginMethod('qrCode'))
    onOpenChange = vi.fn<(open: boolean) => void>()
  })

  it('mounts the QR display while open and shows the title', () => {
    renderWithProviders(<QRCodeLoginDialog open onOpenChange={onOpenChange} />)

    expect(screen.getByText('login.title')).toBeInTheDocument()
    expect(screen.getByTestId('qr-display')).toBeInTheDocument()
  })

  it('renders nothing interactive while closed', () => {
    renderWithProviders(
      <QRCodeLoginDialog open={false} onOpenChange={onOpenChange} />,
    )

    expect(screen.queryByTestId('qr-display')).toBeNull()
    expect(screen.queryByText('login.title')).toBeNull()
  })

  it('unmounts the display on close so polling stops', () => {
    const { rerender } = renderWithProviders(
      <QRCodeLoginDialog open onOpenChange={onOpenChange} />,
    )
    expect(screen.getByTestId('qr-display')).toBeInTheDocument()

    rerender(
      wrap(<QRCodeLoginDialog open={false} onOpenChange={onOpenChange} />),
    )

    expect(screen.queryByTestId('qr-display')).toBeNull()
  })

  it('closes the dialog when the display reports login success', async () => {
    const { user } = renderWithProviders(
      <QRCodeLoginDialog open onOpenChange={onOpenChange} />,
    )

    await user.click(screen.getByRole('button', { name: 'simulate-success' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('forwards open-change events from the dialog shell', () => {
    renderWithProviders(<QRCodeLoginDialog open onOpenChange={onOpenChange} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('offers the Firefox cookie tab and mounts its panel on selection', async () => {
    const { user } = renderWithProviders(
      <QRCodeLoginDialog open onOpenChange={onOpenChange} />,
    )

    expect(screen.queryByTestId('firefox-panel')).toBeNull()
    await user.click(
      screen.getByRole('tab', { name: 'login.firefoxCookieTab' }),
    )

    expect(screen.getByTestId('firefox-panel')).toBeInTheDocument()
  })

  it('mounts the permission notice and closes on a granted check', async () => {
    store.dispatch(setFirefoxAccessDenied(true))
    store.dispatch(setLoginMethod('firefox'))
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'get_cookie'
        ? Promise.resolve('loaded')
        : cmd === 'fetch_user'
          ? Promise.resolve(loggedInUser)
          : Promise.resolve(undefined),
    )
    const { user } = renderWithProviders(
      <QRCodeLoginDialog open onOpenChange={onOpenChange} />,
    )

    expect(
      screen.getByText('login.firefoxPermissionNotice'),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'login.firefoxPermissionCheck' }),
    )

    await waitFor(() =>
      expect(store.getState().init.firefoxAccessDenied).toBe(false),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens on the Firefox tab when firefox is the login method', () => {
    store.dispatch(setLoginMethod('firefox'))
    renderWithProviders(<QRCodeLoginDialog open onOpenChange={onOpenChange} />)

    expect(
      screen.getByRole('tab', { name: 'login.firefoxCookieTab' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('firefox-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('qr-display')).toBeNull()
  })

  it('opens on the manual tab when manual is the login method', () => {
    store.dispatch(setLoginMethod('manual'))
    renderWithProviders(<QRCodeLoginDialog open onOpenChange={onOpenChange} />)

    expect(
      screen.getByRole('tab', { name: 'login.manualCookieTab' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('qr-display')).toBeNull()
  })

  it('re-reads the login method on every open', () => {
    const { rerender } = renderWithProviders(
      <QRCodeLoginDialog open onOpenChange={onOpenChange} />,
    )
    rerender(
      wrap(<QRCodeLoginDialog open={false} onOpenChange={onOpenChange} />),
    )
    expect(screen.queryByRole('tablist')).toBeNull()

    store.dispatch(setLoginMethod('manual'))
    rerender(wrap(<QRCodeLoginDialog open onOpenChange={onOpenChange} />))

    expect(
      screen.getByRole('tab', { name: 'login.manualCookieTab' }),
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('switches the login method to manual when a paste is applied', async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'fetch_user'
        ? Promise.resolve(loggedInUser)
        : Promise.resolve(undefined),
    )
    const { user } = renderWithProviders(
      <QRCodeLoginDialog open onOpenChange={onOpenChange} />,
    )
    await user.click(screen.getByRole('tab', { name: 'login.manualCookieTab' }))
    await user.type(screen.getByLabelText('login.manualCookie'), 'SESSDATA=abc')
    await user.click(
      screen.getByRole('button', { name: 'login.manualCookieApply' }),
    )

    await waitFor(() =>
      expect(store.getState().login.loginMethod).toBe('manual'),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the login method and stays open when a paste is rejected', async () => {
    mockInvoke.mockRejectedValue('ERR::MANUAL_COOKIE_INVALID')
    const { user } = renderWithProviders(
      <QRCodeLoginDialog open onOpenChange={onOpenChange} />,
    )
    await user.click(screen.getByRole('tab', { name: 'login.manualCookieTab' }))
    await user.type(
      screen.getByLabelText('login.manualCookie'),
      'SESSDATA=stale',
    )
    await user.click(
      screen.getByRole('button', { name: 'login.manualCookieApply' }),
    )

    expect(
      await screen.findByText('login.manualCookieInvalid'),
    ).toBeInTheDocument()
    expect(store.getState().login.loginMethod).toBe('qrCode')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
