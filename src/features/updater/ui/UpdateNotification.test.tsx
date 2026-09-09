/**
 * UpdateNotification suite.
 *
 * The dialog renders only while `updater.showDialog` is true; the real
 * updaterSlice in the singleton store drives every body/footer branch
 * (downloading / ready / error / release notes / spinner). The
 * useUpdateDownload hook is mocked — its Started→Progress→Finished
 * ladder is covered by useUpdateDownload.test.tsx.
 */

import { store } from '@/app/store'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const downloadHook = vi.hoisted(() => ({
  handleUpdate: vi.fn(),
  handleRetry: vi.fn(),
  handleRestart: vi.fn(),
  handleSkipVersion: vi.fn(),
}))

vi.mock('@/features/updater', async (importActual) => {
  const actual = await importActual<typeof import('@/features/updater')>()
  return {
    ...actual,
    useUpdateDownload: () => downloadHook,
  }
})

import {
  resetUpdater,
  setError,
  setIsDownloading,
  setIsUpdateReady,
  setReleaseNotes,
  setUpdateAvailable,
} from '@/features/updater/model/updaterSlice'
import { UpdateNotification } from './UpdateNotification'

function renderDialog() {
  return renderWithProviders(<UpdateNotification />)
}

/** Opens the dialog with an available update between two versions. */
function openWithUpdate() {
  store.dispatch(
    setUpdateAvailable({
      available: true,
      latestVersion: '1.52.0',
      currentVersion: '1.51.0',
    }),
  )
}

describe('UpdateNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.dispatch(resetUpdater())
    mockInvoke.mockResolvedValue(undefined)
  })

  it('renders nothing while the dialog is closed', () => {
    renderDialog()

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows both versions in the header when an update is available', async () => {
    openWithUpdate()
    renderDialog()

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('v1.51.0')).toBeInTheDocument()
    // Title heading + latest badge both carry it
    expect(screen.getAllByText('v1.52.0').length).toBeGreaterThan(0)
  })

  it('focuses the primary Update Now button on open (not the skip secondary)', async () => {
    openWithUpdate()
    renderDialog()

    await screen.findByRole('dialog')
    expect(
      screen.getByRole('button', { name: 'updater.actions.update_now' }),
    ).toHaveFocus()
  })

  it('renders markdown release notes through the custom components', async () => {
    openWithUpdate()
    store.dispatch(setReleaseNotes('# Release 1.52\n\n**bold** and `code`'))
    renderDialog()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Release 1.52' }),
    ).toBeInTheDocument()
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('shows the spinner body while no notes are loaded yet', async () => {
    openWithUpdate()
    renderDialog()

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    // Waiting branch: animated spinner, no notes container, no progress label
    expect(document.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByText('updater.downloading')).toBeNull()
  })

  it('locks the footer actions and swaps the label while downloading', () => {
    openWithUpdate()
    store.dispatch(setIsDownloading(true))
    renderDialog()

    expect(screen.getByText('updater.actions.downloading')).toBeInTheDocument()
    const skip = screen.getByRole('button', {
      name: 'updater.actions.skip_version',
    })
    const update = screen.getByRole('button', {
      name: 'updater.actions.downloading',
    })
    expect(skip).toBeDisabled()
    expect(update).toBeDisabled()
  })

  it('offers restart once the update is ready', async () => {
    openWithUpdate()
    store.dispatch(setIsUpdateReady(true))
    const { user } = renderDialog()

    // Issue #599: no "Later"/skip cancel in the ready state — restart is
    // the only footer action; ESC still closes via onOpenChange.
    expect(
      screen.queryByRole('button', { name: 'updater.actions.skip_version' }),
    ).toBeNull()

    await user.click(
      screen.getByRole('button', { name: 'updater.actions.restart' }),
    )

    expect(downloadHook.handleRestart).toHaveBeenCalledTimes(1)
  })

  it('surfaces the error body and wires the retry button', async () => {
    openWithUpdate()
    store.dispatch(setError('network unreachable'))
    const { user } = renderDialog()

    expect(screen.getByText('network unreachable')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'updater.actions.retry' }),
    )

    expect(downloadHook.handleRetry).toHaveBeenCalledTimes(1)
  })

  it('skip button closes the dialog and skips the latest version (issue #599)', async () => {
    openWithUpdate()
    const { user } = renderDialog()
    await screen.findByRole('dialog')

    await user.click(
      screen.getByRole('button', { name: 'updater.actions.skip_version' }),
    )

    expect(downloadHook.handleSkipVersion).toHaveBeenCalledWith('1.52.0')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.getState().updater.showDialog).toBe(false)
  })

  it('closes via the header X button without recording a skip', async () => {
    openWithUpdate()
    const { user } = renderDialog()
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.getState().updater.showDialog).toBe(false)
    expect(downloadHook.handleSkipVersion).not.toHaveBeenCalled()
  })
})
