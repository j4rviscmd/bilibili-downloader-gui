/**
 * FirefoxCookiePanel suite.
 *
 * Covers the switch contract: nothing is persisted before the restart
 * confirmation, confirm persists the Firefox method + relaunches (and
 * syncs the store for the relaunch-failure path), cancel persists
 * nothing, and a failed persist/relaunch keeps the confirmation
 * retryable.
 */

import { store } from '@/app/store'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { relaunch } from '@tauri-apps/plugin-process'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLoginMethod } from '../model/loginSlice'
import { FirefoxCookiePanel } from './FirefoxCookiePanel'

describe('FirefoxCookiePanel', () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined)
    vi.mocked(relaunch).mockReset().mockResolvedValue(undefined)
  })

  it('shows the description and switch button', () => {
    renderWithProviders(<FirefoxCookiePanel />)

    expect(
      screen.getByText('login.firefoxCookieDescription'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'login.useFirefoxCookie' }),
    ).toBeInTheDocument()
  })

  it('persists nothing until the restart is confirmed', async () => {
    const { user } = renderWithProviders(<FirefoxCookiePanel />)

    await user.click(
      screen.getByRole('button', { name: 'login.useFirefoxCookie' }),
    )

    expect(screen.getByText('login.restartRequiredTitle')).toBeInTheDocument()
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(vi.mocked(relaunch)).not.toHaveBeenCalled()
  })

  it('confirms: persists firefox, syncs the store and relaunches', async () => {
    // Initial state is already 'firefox' — seed another method so the
    // sync assertion below can actually fail.
    store.dispatch(setLoginMethod('qrCode'))
    const { user } = renderWithProviders(<FirefoxCookiePanel />)

    await user.click(
      screen.getByRole('button', { name: 'login.useFirefoxCookie' }),
    )
    await user.click(screen.getByRole('button', { name: 'login.restartNow' }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_login_method', {
        method: 'firefox',
      })
    })
    expect(vi.mocked(relaunch)).toHaveBeenCalledTimes(1)
    expect(store.getState().login.loginMethod).toBe('firefox')
  })

  it('keeps the confirmation retryable when the relaunch fails', async () => {
    vi.mocked(relaunch).mockRejectedValueOnce(new Error('relaunch failed'))
    const { user } = renderWithProviders(<FirefoxCookiePanel />)

    await user.click(
      screen.getByRole('button', { name: 'login.useFirefoxCookie' }),
    )
    await user.click(screen.getByRole('button', { name: 'login.restartNow' }))

    expect(await screen.findByText('login.restartFailed')).toBeInTheDocument()

    // Retry succeeds: the method was already persisted, relaunch re-runs
    await user.click(screen.getByRole('button', { name: 'login.restartNow' }))

    await waitFor(() => {
      expect(vi.mocked(relaunch)).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByText('login.restartFailed')).toBeNull()
  })

  it('cancel closes the confirmation without persisting and reopens cleanly', async () => {
    const { user } = renderWithProviders(<FirefoxCookiePanel />)

    await user.click(
      screen.getByRole('button', { name: 'login.useFirefoxCookie' }),
    )
    // Note: Radix sets pointer-events:none on body while the dialog is
    // open, so the overlay element itself is clicked (cf.
    // AccountSection.test.tsx, RestartConfirmDialog.test.tsx)
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    await user.click(overlay as HTMLElement)

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(vi.mocked(relaunch)).not.toHaveBeenCalled()

    // The confirming state was reset — the switch button reopens it
    await user.click(
      screen.getByRole('button', { name: 'login.useFirefoxCookie' }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows the failure hint without relaunching when the persist step fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('backend down'))
    store.dispatch(setLoginMethod('qrCode'))
    const { user } = renderWithProviders(<FirefoxCookiePanel />)

    await user.click(
      screen.getByRole('button', { name: 'login.useFirefoxCookie' }),
    )
    await user.click(screen.getByRole('button', { name: 'login.restartNow' }))

    expect(await screen.findByText('login.restartFailed')).toBeInTheDocument()
    expect(vi.mocked(relaunch)).not.toHaveBeenCalled()
    // The store sync runs only after a successful persist
    expect(store.getState().login.loginMethod).toBe('qrCode')
  })
})
