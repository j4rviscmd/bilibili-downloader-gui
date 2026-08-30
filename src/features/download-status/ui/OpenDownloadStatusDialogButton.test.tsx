/**
 * OpenDownloadStatusDialogButton suite.
 *
 * The FAB hides when nothing is enqueued, otherwise shows the
 * completed/total badge and opens the dialog through the slice action.
 */

import { store } from '@/app/store'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearQueue,
  enqueue,
  updateQueueStatus,
} from '@/shared/queue/queueSlice'

import { OpenDownloadStatusDialogButton } from './OpenDownloadStatusDialogButton'

function seedQueue() {
  store.dispatch(enqueue({ downloadId: 'parent-1', status: 'running' }))
  store.dispatch(
    enqueue({
      downloadId: 'parent-1-p1',
      parentId: 'parent-1',
      status: 'done',
    }),
  )
  store.dispatch(
    enqueue({
      downloadId: 'parent-1-p2',
      parentId: 'parent-1',
      status: 'running',
    }),
  )
}

describe('OpenDownloadStatusDialogButton', () => {
  beforeEach(() => {
    store.dispatch(clearQueue())
  })

  it('renders nothing when there are no downloads', () => {
    const { container } = renderWithProviders(
      <OpenDownloadStatusDialogButton />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the completed/total badge for enqueued parts', () => {
    seedQueue()
    renderWithProviders(<OpenDownloadStatusDialogButton />)

    expect(
      screen.getByRole('button', { name: 'downloadStatus.open' }),
    ).toBeInTheDocument()
    // 1 of 2 parts done
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('opens the dialog on click', async () => {
    seedQueue()
    const { user } = renderWithProviders(<OpenDownloadStatusDialogButton />)

    await user.click(
      screen.getByRole('button', { name: 'downloadStatus.open' }),
    )

    expect(store.getState().downloadStatusDialog.dialogOpen).toBe(true)
  })

  it('excludes cancelled parts from the badge totals', () => {
    seedQueue()
    store.dispatch(
      updateQueueStatus({ downloadId: 'parent-1-p2', status: 'cancelled' }),
    )
    renderWithProviders(<OpenDownloadStatusDialogButton />)

    // Only the completed part counts once the other is cancelled
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })
})
