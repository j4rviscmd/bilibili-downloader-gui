/**
 * QRCodeDisplay suite.
 *
 * The useLogin hook and useUser are mocked at the hook level (covered by
 * the F3 hook suites); the component is exercised per loginSlice state
 * shape. MemoryRouter probe routes assert the post-login navigation.
 */

import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { act, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const login = vi.hoisted(() => ({
  state: {
    qrStatus: null as string | null,
    qrCodeImage: null as string | null,
    qrcodeKey: null as string | null,
    statusMessage: '',
    loginMethod: 'firefox' as const,
    session: null,
    isQrLoading: false,
    error: null as string | null,
  },
  generateNewQrCode: vi.fn().mockResolvedValue(undefined),
  stopPolling: vi.fn(),
  resetLogin: vi.fn(),
}))

const userHook = vi.hoisted(() => ({
  // Why resolved shape: the post-success verification path reads
  // user.data.isLogin — undefined would take the ERR::QR_VERIFY_FAILED
  // branch and never navigate.
  getUserInfo: vi.fn().mockResolvedValue({
    code: 0,
    message: '0',
    data: { mid: 42, uname: 'u', isLogin: true },
    hasCookie: true,
  }),
}))

vi.mock('@/features/login/model/useLogin', () => ({
  useLogin: () => ({
    ...login.state,
    generateNewQrCode: login.generateNewQrCode,
    stopPolling: login.stopPolling,
    logout: vi.fn(),
    changeLoginMethod: vi.fn(),
    resetLogin: login.resetLogin,
  }),
}))
vi.mock('@/features/user', () => ({
  useUser: () => ({
    user: null,
    onChangeUser: vi.fn(),
    getUserInfo: userHook.getUserInfo,
  }),
}))

import { QRCodeDisplay } from './QRCodeDisplay'

/** Wraps the component with a /home probe route for navigation asserts. */
function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<QRCodeDisplay />} />
      <Route path="/home" element={<div>HOME-MARKER</div>} />
    </Routes>,
    { route: '/' },
  )
}

describe('QRCodeDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockInvoke.mockResolvedValue(undefined)
    Object.assign(login.state, {
      qrStatus: null,
      qrCodeImage: null,
      qrcodeKey: null,
      statusMessage: '',
      session: null,
      isQrLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the loading state while the first QR code generates', () => {
    Object.assign(login.state, { isQrLoading: true })
    renderLogin()

    expect(screen.getByText('login.generatingQR')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
    // Mount effect requests a code; resetLogin was dropped upstream (it
    // reset loginMethod back to firefox on every mount)
    expect(login.resetLogin).not.toHaveBeenCalled()
    expect(login.generateNewQrCode).toHaveBeenCalled()
  })

  it('renders the QR image with the waiting-for-scan status', async () => {
    Object.assign(login.state, {
      qrStatus: 'waitingForScan',
      qrCodeImage: 'data:image/png;base64,qr',
    })
    renderLogin()

    const img = await screen.findByRole('img', {
      name: 'Bilibili Login QR Code',
    })
    expect(img).toHaveAttribute('src', 'data:image/png;base64,qr')
    expect(screen.getByText('login.scanWithApp')).toBeInTheDocument()
    expect(screen.getByText('login.instructions')).toBeInTheDocument()
  })

  it('shows the confirm-on-phone status while waiting for confirmation', () => {
    Object.assign(login.state, {
      qrStatus: 'scannedWaitingConfirm',
      qrCodeImage: 'data:image/png;base64,qr',
    })
    renderLogin()

    expect(screen.getByText('login.confirmOnPhone')).toBeInTheDocument()
  })

  it('shows the expired overlay with refresh actions', () => {
    Object.assign(login.state, {
      qrStatus: 'expired',
      qrCodeImage: 'data:image/png;base64,qr',
    })
    renderLogin()

    expect(screen.getByText('login.qrExpired')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'login.refresh' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'login.tryAgain' }),
    ).toBeInTheDocument()
  })

  it('refresh button regenerates the QR code', async () => {
    Object.assign(login.state, {
      qrStatus: 'expired',
      qrCodeImage: 'data:image/png;base64,qr',
    })
    const { user } = renderLogin()

    await user.click(screen.getByRole('button', { name: 'login.tryAgain' }))

    expect(login.generateNewQrCode).toHaveBeenCalledTimes(2) // mount + click
  })

  it('on success refreshes user info and navigates home after the delay', async () => {
    vi.useFakeTimers()
    Object.assign(login.state, {
      qrStatus: 'success',
      qrCodeImage: 'data:image/png;base64,qr',
    })
    renderLogin()

    // generateNewQrCode() resolved -> success handling enabled
    await vi.waitFor(() =>
      expect(userHook.getUserInfo).toHaveBeenCalledTimes(1),
    )
    expect(login.stopPolling).toHaveBeenCalled()

    // Still on the login page before the 1.5s delay elapses
    expect(screen.queryByText('HOME-MARKER')).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(screen.getByText('HOME-MARKER')).toBeInTheDocument()
  })

  it('error status maps a known ERR:: code to its translation key', () => {
    Object.assign(login.state, {
      qrStatus: 'error',
      statusMessage: 'x ERR::VIDEO_NOT_FOUND y',
    })
    renderLogin()

    expect(screen.getByText('video.video_not_found')).toBeInTheDocument()
  })

  it('error status falls back to the raw status message for unknown codes', () => {
    Object.assign(login.state, {
      qrStatus: 'error',
      statusMessage: 'mystery failure',
    })
    renderLogin()

    expect(screen.getByText('mystery failure')).toBeInTheDocument()
  })

  it('error status uses the generic failure text without a message', () => {
    Object.assign(login.state, { qrStatus: 'error', statusMessage: '' })
    renderLogin()

    expect(screen.getByText('login.loginFailed')).toBeInTheDocument()
  })

  it('renders a polling error verbatim when it has no known code', () => {
    Object.assign(login.state, {
      qrStatus: 'waitingForScan',
      qrCodeImage: 'data:image/png;base64,qr',
      error: 'poll request failed',
    })
    renderLogin()

    expect(screen.getByText('poll request failed')).toBeInTheDocument()
  })
})
