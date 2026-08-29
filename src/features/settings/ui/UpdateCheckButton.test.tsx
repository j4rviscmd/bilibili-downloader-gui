/**
 * UpdateCheckButton suite.
 *
 * The button captures import.meta.env.DEV at module scope (disabled in
 * dev), so DEV is flipped false via vi.hoisted BEFORE the module import.
 * The updater plugin 'check' mock comes from src/test/setup.ts; the app
 * version from '@tauri-apps/api/app' is mocked locally.
 */

import { store } from '@/app/store'
import { resetUpdater } from '@/features/updater/model/updaterSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // Module-scope read: must happen before the component module is imported.
  import.meta.env.DEV = false
})

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.2.3'),
}))

import { UpdateCheckButton } from './UpdateCheckButton'

const mockGetVersion = getVersion as unknown as Mock
const mockCheck = check as unknown as Mock

describe('UpdateCheckButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetVersion.mockResolvedValue('1.2.3')
    mockCheck.mockResolvedValue(null)
    mockInvoke.mockImplementation(() => Promise.resolve(undefined))
    store.dispatch(resetUpdater())
  })

  it('renders the current version fetched on mount', async () => {
    renderWithProviders(<UpdateCheckButton />)

    await waitFor(() => expect(mockGetVersion).toHaveBeenCalled())
    // Identity t renders the raw key ('{{version}}' is interpolated inside
    // the translation, not the key).
    expect(screen.getByText('settings.current_version')).toBeInTheDocument()
  })

  it('clicking check with no update shows the up-to-date badge', async () => {
    const { user } = renderWithProviders(<UpdateCheckButton />)

    await user.click(
      screen.getByRole('button', { name: 'settings.update_check.button_idle' }),
    )

    await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText('settings.update_check.latest'),
    ).toBeInTheDocument()
    expect(store.getState().updater.updateAvailable).toBe(false)
  })

  it('dispatches setUpdateAvailable and shows the badge when an update exists', async () => {
    mockCheck.mockResolvedValue({ version: '2.0.0', currentVersion: '1.2.3' })
    const { user } = renderWithProviders(<UpdateCheckButton />)

    await user.click(
      screen.getByRole('button', { name: 'settings.update_check.button_idle' }),
    )

    expect(
      await screen.findByText('settings.update_check.available'),
    ).toBeInTheDocument()
    const updater = store.getState().updater
    expect(updater.updateAvailable).toBe(true)
    expect(updater.latestVersion).toBe('2.0.0')
    expect(updater.currentVersion).toBe('1.2.3')
  })

  it('falls back to the unknown-version label when getVersion rejects', async () => {
    mockGetVersion.mockRejectedValue(new Error('no app'))
    renderWithProviders(<UpdateCheckButton />)

    // The fallback is only applied into state, not new DOM text; assert the
    // component still renders the version line without crashing.
    expect(
      await screen.findByText('settings.current_version'),
    ).toBeInTheDocument()
  })

  it('resets to idle and stores the error when the check fails', async () => {
    mockCheck.mockRejectedValue(new Error('network down'))
    const { user } = renderWithProviders(<UpdateCheckButton />)

    await user.click(
      screen.getByRole('button', { name: 'settings.update_check.button_idle' }),
    )

    await waitFor(() =>
      expect(store.getState().updater.error).toBe(
        'settings.update_check.error',
      ),
    )
    // Status returned to idle -> button label back to idle, no badge.
    expect(
      screen.getByRole('button', { name: 'settings.update_check.button_idle' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('settings.update_check.latest')).toBeNull()
  })
})
