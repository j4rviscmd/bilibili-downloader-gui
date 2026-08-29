/**
 * WatchHistoryItem suite.
 *
 * Presentational entry row: metadata, progress bar width, copy toast and
 * the download callback (incl. the disabled tooltip wiring).
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchHistoryEntry } from '../types'
import { WatchHistoryItem } from './WatchHistoryItem'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'

const toastSuccess = toast.success as unknown as Mock

const entry: WatchHistoryEntry = {
  title: 'Watched Video',
  cover: 'https://img.example/cover.jpg',
  bvid: 'BV1yy',
  cid: 1,
  page: 1,
  viewAt: Math.floor((Date.now() - 2 * 24 * 3600 * 1000) / 1000),
  duration: 2000,
  progress: 1000, // exactly 50%
  url: 'https://www.bilibili.com/video/BV1yy',
}

const writeText = vi.fn().mockResolvedValue(undefined)

function renderEntry(overrides: Partial<WatchHistoryEntry> = {}) {
  const onDownload = vi.fn()
  const utils = renderWithProviders(
    <WatchHistoryItem
      entry={{ ...entry, ...overrides }}
      onDownload={onDownload}
    />,
  )
  return { ...utils, onDownload }
}

describe('WatchHistoryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title, url and thumbnail', () => {
    renderEntry()

    expect(screen.getByText('Watched Video')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: entry.url })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Watched Video' })).toHaveAttribute(
      'src',
      entry.cover,
    )
  })

  it('shows the short duration and the relative view time', () => {
    renderEntry()

    expect(screen.getByText('33:20')).toBeInTheDocument()
    expect(screen.getByText('watchHistory.time.daysAgo')).toBeInTheDocument()
  })

  it('sizes the progress bar from progress/duration', () => {
    renderEntry()

    const bar = document.querySelector<HTMLElement>('.bg-gradient-to-r')
    expect(bar).not.toBeNull()
    expect(bar!.style.width).toBe('50%')
  })

  it('copies the URL and toasts success', async () => {
    const { user } = renderEntry()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    await user.click(screen.getByTitle('history.copyUrl'))

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(entry.url))
    expect(toastSuccess).toHaveBeenCalledWith('history.copySuccess')
  })

  it('invokes onDownload with the entry', async () => {
    const { user, onDownload } = renderEntry()

    await user.click(
      screen.getByRole('button', { name: 'watchHistory.download' }),
    )

    expect(onDownload).toHaveBeenCalledWith(entry)
  })

  it('disables the download button when disabled', () => {
    renderWithProviders(
      <WatchHistoryItem entry={entry} onDownload={vi.fn()} disabled />,
    )

    expect(
      screen.getByRole('button', { name: 'watchHistory.download' }),
    ).toBeDisabled()
  })
})
