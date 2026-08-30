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

    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('shows both versions in the header when an update is available', async () => {
    openWithUpdate()
    renderDialog()

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('v1.51.0')).toBeInTheDocument()
    // Title heading + latest badge both carry it
    expect(screen.getAllByText('v1.52.0').length).toBeGreaterThan(0)
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

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    // Waiting branch: animated spinner, no notes container, no progress label
    expect(document.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByText('updater.downloading')).toBeNull()
  })

  it('locks the footer actions and swaps the label while downloading', () => {
    openWithUpdate()
    store.dispatch(setIsDownloading(true))
    renderDialog()

    expect(screen.getByText('updater.actions.downloading')).toBeInTheDocument()
    const later = screen.getByRole('button', { name: 'updater.actions.later' })
    const update = screen.getByRole('button', {
      name: 'updater.actions.downloading',
    })
    expect(later).toBeDisabled()
    expect(update).toBeDisabled()
  })

  it('offers restart once the update is ready', async () => {
    openWithUpdate()
    store.dispatch(setIsUpdateReady(true))
    const { user } = renderDialog()

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

  it('closing the dialog hides it again', async () => {
    openWithUpdate()
    const { user } = renderDialog()
    await screen.findByRole('alertdialog')

    await user.click(
      screen.getByRole('button', { name: 'updater.actions.later' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(store.getState().updater.showDialog).toBe(false)
  })
})
