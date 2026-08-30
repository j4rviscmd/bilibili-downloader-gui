/**
 * WatchHistoryList suite.
 *
 * Loading/empty states render synchronously. happy-dom cannot give
 * react-virtuoso a viewport, so the populated path runs through a
 * Virtuoso stub that executes itemContent/endReached/components.Footer
 * directly (same technique as FavoriteList.test.tsx). Per-entry
 * behavior is covered by WatchHistoryItem.test.tsx.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { WatchHistoryEntry } from '../types'
import { WatchHistoryList } from './WatchHistoryList'

// Minimal Virtuoso stand-in: renders every item through itemContent,
// mounts the Footer component and fires endReached once (deferred so
// React has committed first).
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
    endReached,
    components,
  }: {
    data: unknown[]
    itemContent: (index: number, item: unknown) => React.ReactNode
    endReached?: () => void
    components?: { Footer?: () => React.ReactNode }
  }) => {
    Promise.resolve().then(() => endReached?.())
    const Footer = components?.Footer
    return (
      <div data-virtuoso-scroller>
        {data.map((item, i) => (
          <div key={i}>{itemContent(i, item)}</div>
        ))}
        {Footer ? <Footer /> : null}
      </div>
    )
  },
}))

const entry: WatchHistoryEntry = {
  title: 'A watched video',
  cover: 'https://img.example/c.jpg',
  bvid: 'BV1zz',
  cid: 1,
  page: 1,
  viewAt: Math.floor(Date.now() / 1000),
  duration: 100,
  progress: 10,
  url: 'https://www.bilibili.com/video/BV1zz',
}

function renderList(
  overrides: Partial<Parameters<typeof WatchHistoryList>[0]> = {},
) {
  const onLoadMore = vi.fn()
  const onDownload = vi.fn()
  renderWithProviders(
    <WatchHistoryList
      entries={[entry]}
      loading={false}
      loadingMore={false}
      hasMore={false}
      onLoadMore={onLoadMore}
      onDownload={onDownload}
      {...overrides}
    />,
  )
  return { onLoadMore, onDownload }
}

beforeAll(() => {
  // happy-dom ships no ResizeObserver; react-virtuoso requires one.
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

describe('WatchHistoryList', () => {
  it('shows the loading spinner while the initial fetch runs', () => {
    renderList({ loading: true })

    expect(document.querySelector('[data-virtuoso-scroller]')).toBeNull()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('shows the empty state when there are no entries', () => {
    renderList({ entries: [] })

    expect(screen.getByText('watchHistory.empty')).toBeInTheDocument()
  })

  it('renders every entry and requests the next page at the end', async () => {
    const { onLoadMore } = renderList({ hasMore: true })

    // itemContent executed through the stub
    expect(screen.getByText('A watched video')).toBeInTheDocument()
    await vi.waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1))
  })

  it('does not request more pages while a page is loading', async () => {
    const { onLoadMore } = renderList({ hasMore: true, loadingMore: true })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does not request more pages when hasMore is false', async () => {
    const { onLoadMore } = renderList({ hasMore: false })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('shows the footer spinner only while loading more', () => {
    const props = {
      entries: [entry],
      loading: false,
      loadingMore: true,
      hasMore: true,
      onLoadMore: vi.fn(),
      onDownload: vi.fn(),
    }
    const { rerender } = renderWithProviders(<WatchHistoryList {...props} />)

    // Footer renders a centered spinner block while loadingMore
    expect(document.querySelector('.py-4')).not.toBeNull()

    rerender(<WatchHistoryList {...props} loadingMore={false} />)

    // Footer returns null otherwise: last child is the entry row itself
    expect(document.querySelector('.py-4')).toBeNull()
    const scroller = document.querySelector('[data-virtuoso-scroller]')!
    expect(scroller.lastElementChild?.textContent).toContain('A watched video')
  })
})
