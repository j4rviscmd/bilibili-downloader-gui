/**
 * QRCodeLoginDialog suite.
 *
 * QRCodeDisplay has its own suite; it is stubbed here so this file covers
 * only the dialog contract: mounts the display while open, unmounts on
 * close (stopping polling), and closes itself on login success.
 */

import { store } from '@/app/store'
import { setFirefoxAccessDenied } from '@/features/init/model/initSlice'
import { setUser } from '@/features/user/userSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
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

describe('QRCodeLoginDialog', () => {
  let onOpenChange: (open: boolean) => void

  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setFirefoxAccessDenied(false))
    store.dispatch(setUser(loggedOutUser))
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

    rerender(<QRCodeLoginDialog open={false} onOpenChange={onOpenChange} />)

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
})
