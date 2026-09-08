/**
 * UpdateAvailableButton suite.
 *
 * The real updaterSlice in the singleton store drives visibility; the
 * GitHub notes fetch runs through the global mockInvoke. UpdateNotification
 * rendering is covered by its own suite — here only the open/fetch
 * dispatch contract matters.
 */

import { store } from '@/app/store'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  resetUpdater,
  setReleaseNotes,
  setUpdateAvailable,
} from '@/features/updater/model/updaterSlice'
import { UpdateAvailableButton } from './UpdateAvailableButton'

beforeEach(() => {
  vi.clearAllMocks()
  store.dispatch(resetUpdater())
  mockInvoke.mockResolvedValue(undefined)
})

function updater() {
  return store.getState().updater
}

describe('UpdateAvailableButton', () => {
  it('renders nothing while no update is available', () => {
    renderWithProviders(<UpdateAvailableButton />)

    expect(
      screen.queryByRole('button', { name: 'updater.update_available' }),
    ).toBeNull()
  })

  it('renders while an update is available (including skipped versions)', () => {
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: '1.52.0',
        currentVersion: '1.51.0',
        showDialog: false,
      }),
    )
    renderWithProviders(<UpdateAvailableButton />)

    expect(
      screen.getByRole('button', { name: 'updater.update_available' }),
    ).toBeInTheDocument()
  })

  it('refetches notes and replaces a stale fallback message, then opens the dialog', async () => {
    // Why this case matters: a rate-limited startup stores the fallback
    // string as non-null releaseNotes — the click must retry anyway.
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: '1.52.0',
        currentVersion: '1.51.0',
      }),
    )
    store.dispatch(setReleaseNotes('updater.no_release_notes'))
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'get_release_notes'
        ? Promise.resolve('## fetched notes')
        : Promise.resolve(undefined),
    )
    const { user } = renderWithProviders(<UpdateAvailableButton />)

    await user.click(
      screen.getByRole('button', { name: 'updater.update_available' }),
    )

    await waitFor(() => expect(updater().showDialog).toBe(true))
    expect(updater().releaseNotes).toBe('## fetched notes')
    expect(mockInvoke).toHaveBeenCalledWith('get_release_notes', {
      owner: 'j4rviscmd',
      repo: 'bilibili-downloader-gui',
      currentVersion: '1.51.0',
    })
  })

  it('refetches even when valid notes are already present', async () => {
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: '1.52.0',
        currentVersion: '1.51.0',
      }),
    )
    store.dispatch(setReleaseNotes('## stale notes'))
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'get_release_notes'
        ? Promise.resolve('## fresh notes')
        : Promise.resolve(undefined),
    )
    const { user } = renderWithProviders(<UpdateAvailableButton />)

    await user.click(
      screen.getByRole('button', { name: 'updater.update_available' }),
    )

    await waitFor(() => expect(updater().showDialog).toBe(true))
    expect(updater().releaseNotes).toBe('## fresh notes')
  })

  it('opens the dialog immediately with the spinner body while fetching', async () => {
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: '1.52.0',
        currentVersion: '1.51.0',
      }),
    )
    store.dispatch(setReleaseNotes('## old notes'))
    let resolveFetch!: (notes: string) => void
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'get_release_notes'
        ? new Promise<string>((resolve) => {
            resolveFetch = resolve
          })
        : Promise.resolve(undefined),
    )
    const { user } = renderWithProviders(<UpdateAvailableButton />)

    await user.click(
      screen.getByRole('button', { name: 'updater.update_available' }),
    )

    // Dialog opens and notes are cleared before the fetch resolves —
    // the dialog's spinner branch is the loading indicator.
    expect(updater().showDialog).toBe(true)
    expect(updater().releaseNotes).toBeNull()

    resolveFetch('## fresh notes')
    await waitFor(() => expect(updater().releaseNotes).toBe('## fresh notes'))
  })

  it('notes-fetch failure falls back and still opens the dialog', async () => {
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: '1.52.0',
        currentVersion: '1.51.0',
      }),
    )
    mockInvoke.mockRejectedValue(new Error('rate limited'))
    const { user } = renderWithProviders(<UpdateAvailableButton />)

    await user.click(
      screen.getByRole('button', { name: 'updater.update_available' }),
    )

    await waitFor(() => expect(updater().showDialog).toBe(true))
    expect(updater().releaseNotes).toBe('updater.no_release_notes')
  })
})
