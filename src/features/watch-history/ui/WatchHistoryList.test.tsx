/**
 * WatchHistoryList suite.
 *
 * Loading/empty states render synchronously. Like HistoryList, entries
 * go through react-virtuoso, which cannot compute a viewport under
 * happy-dom (zero-sized rects, no layout engine) — infinite-scroll
 * (endReached) and item rendering are therefore not exercised here;
 * per-entry behavior is covered by WatchHistoryItem.test.tsx.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { WatchHistoryEntry } from '../types'
import { WatchHistoryList } from './WatchHistoryList'

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
  it('shows the empty state when there are no entries', () => {
    renderWithProviders(
      <WatchHistoryList
        entries={[]}
        loading={false}
        loadingMore={false}
        hasMore={false}
        onLoadMore={vi.fn()}
        onDownload={vi.fn()}
      />,
    )

    expect(screen.getByText('watchHistory.empty')).toBeInTheDocument()
  })

  it('mounts the virtualized scroller when entries exist', () => {
    renderWithProviders(
      <WatchHistoryList
        entries={[entry]}
        loading={false}
        loadingMore={false}
        hasMore={false}
        onLoadMore={vi.fn()}
        onDownload={vi.fn()}
      />,
    )

    expect(
      document.querySelector('[data-virtuoso-scroller]'),
    ).toBeInTheDocument()
  })
})

// Skipped: loading-state spinner assert — the loading branch renders only a
// CircleIndicator (shared/ui, no text) and is covered by its own suite.
