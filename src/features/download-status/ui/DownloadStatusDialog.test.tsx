/**
 * DownloadStatusDialog suite.
 *
 * Renders against the real store seeded with queue children + partInputs:
 * open/close gating, empty state, per-part rows, and the cancel wiring that
 * also deselects the part in the input slice.
 */

import { store } from '@/app/store'
import { initPartInputs } from '@/features/video/model/inputSlice'
import { clearQueue, enqueue } from '@/shared/queue'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  closeDownloadStatusDialog,
  openDownloadStatusDialog,
} from '../model/downloadStatusDialogSlice'
import { DownloadStatusDialog } from './DownloadStatusDialog'

/** Parent + two children; partInputs provide the row titles. */
function seedQueue() {
  store.dispatch(
    enqueue({ downloadId: 'parent-1', filename: 'video', status: 'pending' }),
  )
  store.dispatch(
    enqueue({
      downloadId: 'parent-1-p1',
      parentId: 'parent-1',
      status: 'running',
    }),
  )
  store.dispatch(
    enqueue({
      downloadId: 'parent-1-p2',
      parentId: 'parent-1',
      status: 'pending',
    }),
  )
  store.dispatch(
    initPartInputs([
      {
        cid: 1,
        page: 1,
        title: 'First part',
        videoQuality: '',
        audioQuality: '',
        selected: true,
        duration: 60,
      },
      {
        cid: 2,
        page: 2,
        title: 'Second part',
        videoQuality: '',
        audioQuality: '',
        selected: true,
        duration: 60,
      },
    ]),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockResolvedValue(undefined)
  store.dispatch(clearQueue())
  store.dispatch(closeDownloadStatusDialog())
  seedQueue()
})

describe('DownloadStatusDialog', () => {
  it('renders nothing while the dialog is closed', () => {
    renderWithProviders(<DownloadStatusDialog />)

    expect(screen.queryByText('downloadStatus.title')).toBeNull()
    expect(screen.queryByText('First part')).toBeNull()
  })

  it('shows the title and one row per child when open', () => {
    store.dispatch(openDownloadStatusDialog('parent-1'))
    renderWithProviders(<DownloadStatusDialog />)

    expect(screen.getByText('downloadStatus.title')).toBeInTheDocument()
    expect(screen.getByText('First part')).toBeInTheDocument()
    expect(screen.getByText('Second part')).toBeInTheDocument()
  })

  it('shows the empty-state message when the parent has no children', () => {
    store.dispatch(clearQueue())
    store.dispatch(enqueue({ downloadId: 'lone-parent', status: 'pending' }))
    store.dispatch(openDownloadStatusDialog('lone-parent'))
    renderWithProviders(<DownloadStatusDialog />)

    expect(screen.getByText('downloadStatus.no_downloads')).toBeInTheDocument()
  })

  it('closing via Escape flips dialogOpen back to false', () => {
    store.dispatch(openDownloadStatusDialog('parent-1'))
    renderWithProviders(<DownloadStatusDialog />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(store.getState().downloadStatusDialog.dialogOpen).toBe(false)
  })

  it('cancelling a running part marks it cancelling and deselects the part', async () => {
    store.dispatch(openDownloadStatusDialog('parent-1'))
    renderWithProviders(<DownloadStatusDialog />)

    // Both rows are cancellable (running + pending); cancel the first row's
    // button specifically (the dialog also renders the cancel-all button).
    const firstRow = screen.getByText('First part').closest('div')
    const cancelButton = firstRow?.querySelector('button')
    expect(cancelButton).not.toBeNull()
    fireEvent.click(cancelButton!)

    await waitFor(() => {
      // cancelDownload thunk flips the child to cancelling.
      const child = store
        .getState()
        .queue.find((q) => q.downloadId === 'parent-1-p1')
      expect(child?.status).toBe('cancelling')
    })
    // partIndex is 1-based; index 0 selection must be cleared.
    expect(store.getState().input.partInputs[0]?.selected).toBe(false)
    expect(store.getState().input.partInputs[1]?.selected).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('cancel_download', {
      downloadId: 'parent-1-p1',
    })
  })

  it('re-renders rows from the queue when the parent is switched', () => {
    store.dispatch(
      enqueue({ downloadId: 'parent-2', filename: 'other', status: 'pending' }),
    )
    store.dispatch(
      enqueue({
        downloadId: 'parent-2-p1',
        parentId: 'parent-2',
        status: 'done',
      }),
    )
    store.dispatch(openDownloadStatusDialog('parent-2'))
    renderWithProviders(<DownloadStatusDialog />)

    // Only parent-2's child is listed; its title falls back to partInputs[0].
    expect(screen.getByText('First part')).toBeInTheDocument()
    expect(screen.queryByText('Second part')).toBeNull()
  })
})
