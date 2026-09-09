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
    // 1st invoke: get_settings (skip check), 2nd: get_release_notes
    mockInvoke.mockResolvedValueOnce(undefined)
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
    mockInvoke.mockResolvedValueOnce(undefined)
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
    // get_settings runs up front (dev gate + skip check) but the notes
    // fetch must not fire when there is no update.
    expect(mockInvoke).not.toHaveBeenCalledWith('get_release_notes', {
      owner: 'j4rviscmd',
      repo: 'bilibili-downloader-gui',
      currentVersion: expect.anything(),
    })
  })

  it('release-notes failure stores the fallback message', async () => {
    vi.mocked(check).mockResolvedValue({
      version: '2.0.0',
      currentVersion: '1.5.0',
    } as never)
    mockInvoke.mockResolvedValueOnce(undefined)
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

  it('skipped latest version suppresses the dialog but keeps availability (issue #599)', async () => {
    vi.mocked(check).mockResolvedValue({
      version: '9.9.9',
      currentVersion: '1.0.0',
    } as never)
    mockInvoke.mockResolvedValueOnce({ skippedUpdateVersion: '9.9.9' })

    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)

    await waitFor(() => expect(updater().updateAvailable).toBe(true))
    expect(updater().showDialog).toBe(false)
    expect(mockInvoke).toHaveBeenCalledWith('get_settings')
    // Suppressed dialog must not burn GitHub API quota on notes either.
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'get_release_notes',
      expect.anything(),
    )
  })

  it('different latest version auto-shows the dialog despite a skip record', async () => {
    vi.mocked(check).mockResolvedValue({
      version: '9.9.9',
      currentVersion: '1.0.0',
    } as never)
    mockInvoke.mockResolvedValueOnce({ skippedUpdateVersion: '9.0.0' })
    mockInvoke.mockResolvedValueOnce('## release notes')

    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)

    await waitFor(() => expect(updater().updateAvailable).toBe(true))
    expect(updater().showDialog).toBe(true)
  })

  it('get_settings failure fails open (dialog shows)', async () => {
    vi.mocked(check).mockResolvedValue({
      version: '9.9.9',
      currentVersion: '1.0.0',
    } as never)
    mockInvoke.mockRejectedValueOnce(new Error('settings unreadable'))
    mockInvoke.mockResolvedValueOnce('## release notes')

    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)

    await waitFor(() => expect(updater().updateAvailable).toBe(true))
    expect(updater().showDialog).toBe(true)
  })

  it('dev build skips the check when the dev-updater option is off (default)', async () => {
    vi.stubEnv('DEV', true)
    vi.mocked(check).mockResolvedValue(null)

    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)

    // get_settings runs (gate read), but the plugin check never fires.
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('get_settings'))
    expect(check).not.toHaveBeenCalled()
    expect(updater().updateAvailable).toBe(false)
  })

  it('dev build runs the check when the dev-updater option is on', async () => {
    vi.stubEnv('DEV', true)
    mockInvoke.mockResolvedValueOnce({ enableDevUpdater: true })
    mockInvoke.mockResolvedValueOnce('## release notes')
    vi.mocked(check).mockResolvedValue({
      version: '9.9.9',
      currentVersion: '1.0.0',
    } as never)

    renderWithProviders(<UpdaterProvider>child</UpdaterProvider>)

    await waitFor(() => expect(updater().updateAvailable).toBe(true))
    expect(updater().showDialog).toBe(true)
  })
})
