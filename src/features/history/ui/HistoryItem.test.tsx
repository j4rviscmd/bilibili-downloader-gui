/**
 * HistoryItem suite.
 *
 * Pure presentational entry row: asserts rendered metadata, the copy /
 * delete / download callbacks and the failed-state error line. Toast is
 * mocked locally (identity t keys).
 */

import type { HistoryEntry } from '@/features/history/model/historySlice'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'
import HistoryItem from './HistoryItem'

const toastSuccess = toast.success as unknown as Mock

const completed: HistoryEntry = {
  id: '1',
  title: 'Sample Video',
  bvid: 'BV1xx',
  url: 'https://www.bilibili.com/video/BV1xx',
  filename: 'sample.mp4',
  downloadedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  duration: 125,
  status: 'completed',
  fileSize: 1_500_000,
  quality: '1080p',
  thumbnailUrl: 'https://img.example/th.jpg',
}

const writeText = vi.fn().mockResolvedValue(undefined)

function renderEntry(overrides: Partial<HistoryEntry> = {}) {
  const onDelete = vi.fn()
  const onDownload = vi.fn()
  const utils = renderWithProviders(
    <HistoryItem
      entry={{ ...completed, ...overrides }}
      onDelete={onDelete}
      onDownload={onDownload}
    />,
  )
  return { ...utils, onDelete, onDownload }
}

describe('HistoryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the entry metadata for a completed download', () => {
    renderEntry()

    expect(screen.getByText('Sample Video')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: completed.url }),
    ).toBeInTheDocument()
    expect(screen.getByText('sample.mp4')).toBeInTheDocument()
    expect(screen.getByText('1080p')).toBeInTheDocument()
    expect(screen.getByText('1.5 MB')).toBeInTheDocument()
    expect(screen.getByText('2:05')).toBeInTheDocument() // duration badge
    expect(screen.getByText('history.filterSuccess')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Sample Video' })).toHaveAttribute(
      'src',
      completed.thumbnailUrl,
    )
  })

  it('formats the relative download date', () => {
    renderEntry()

    expect(screen.getByText('watchHistory.time.daysAgo')).toBeInTheDocument()
  })

  it('shows the error line and failed badge for failed entries', () => {
    renderEntry({ status: 'failed', errorMessage: 'network reset' })

    expect(screen.getByText('history.filterFailed')).toBeInTheDocument()
    expect(screen.getByText('network reset')).toBeInTheDocument()
  })

  it('renders the thumbnail placeholder when no thumbnail exists', () => {
    renderEntry({ thumbnailUrl: undefined })

    expect(screen.queryByRole('img')).toBeNull()
  })

  it('copies the URL to the clipboard and toasts success', async () => {
    const { user } = renderEntry()
    // Clipboard stub must be installed AFTER render (happy-dom quirk)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    await user.click(screen.getByTitle('history.copyUrl'))

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(completed.url),
    )
    expect(toastSuccess).toHaveBeenCalledWith('history.copySuccess')
  })

  it('invokes onDelete from the delete button', async () => {
    const { user, onDelete } = renderEntry()

    await user.click(screen.getByTitle('history.deleteConfirm'))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('invokes onDownload from the download button', async () => {
    const { user, onDownload } = renderEntry()

    await user.click(
      screen.getByRole('button', { name: 'watchHistory.download' }),
    )

    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('disables the download button and keeps it rendered when disabled', () => {
    renderWithProviders(
      <HistoryItem
        entry={completed}
        onDelete={vi.fn()}
        onDownload={vi.fn()}
        disabled
      />,
    )

    expect(
      screen.getByRole('button', { name: 'watchHistory.download' }),
    ).toBeDisabled()
  })

  it('omits the download button when the entry has no bvid', () => {
    renderEntry({ bvid: undefined })

    expect(
      screen.queryByRole('button', { name: 'watchHistory.download' }),
    ).toBeNull()
  })
})
