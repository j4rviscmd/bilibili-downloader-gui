/**
 * UpdaterProvider suite.
 *
 * The provider early-returns when import.meta.env.DEV is true (the Vitest
 * default), so each test stubs DEV false via vi.stubEnv to exercise the
 * production update-check path.
 */

import { store } from '@/app/store'
import { resetUpdater } from '@/features/updater/model/updaterSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { check } from '@tauri-apps/plugin-updater'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UpdaterProvider } from './UpdaterProvider'

beforeEach(() => {
  vi.clearAllMocks()
  // Why stubEnv: UpdaterProvider early-returns when import.meta.env.DEV is
  // true (Vitest default); stub to false so the production check path runs.
  vi.stubEnv('DEV', false)
  mockInvoke.mockImplementation(() => Promise.resolve(undefined))
  store.dispatch(resetUpdater())
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function updater() {
  return store.getState().updater
}

describe('UpdaterProvider', () => {
  it('dispatches updateAvailable with versions when an update exists', async () => {
    vi.mocked(check).mockResolvedValue({
      version: '9.9.9',
      currentVersion: '1.0.0',
    } as never)
    mockInvoke.mockResolvedValueOnce('## release notes')

    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)

    await waitFor(() => expect(updater().updateAvailable).toBe(true))
    expect(updater().latestVersion).toBe('9.9.9')
    expect(updater().currentVersion).toBe('1.0.0')
  })

  it('fetches release notes via get_release_notes and stores them', async () => {
    vi.mocked(check).mockResolvedValue({
      version: '2.0.0',
      currentVersion: '1.5.0',
    } as never)
    mockInvoke.mockResolvedValueOnce('## v2.0.0 notes')

    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)

    await waitFor(() => expect(updater().releaseNotes).toBe('## v2.0.0 notes'))
    expect(mockInvoke).toHaveBeenCalledWith('get_release_notes', {
      owner: 'j4rviscmd',
      repo: 'bilibili-downloader-gui',
      currentVersion: '1.5.0',
    })
  })

  it('no update leaves state untouched', async () => {
    vi.mocked(check).mockResolvedValue(null)
    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(updater().updateAvailable).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('release-notes failure stores the fallback message', async () => {
    vi.mocked(check).mockResolvedValue({
      version: '2.0.0',
      currentVersion: '1.5.0',
    } as never)
    mockInvoke.mockRejectedValueOnce(new Error('github down'))

    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)

    await waitFor(() =>
      expect(updater().releaseNotes).toBe('updater.no_release_notes'),
    )
    expect(updater().updateAvailable).toBe(true)
  })

  it('update check failure is swallowed (no crash, no state change)', async () => {
    vi.mocked(check).mockRejectedValue(new Error('offline'))
    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(updater().updateAvailable).toBe(false)
  })
})
