/**
 * FavoriteList suite.
 *
 * Loading/empty states render synchronously. The populated path is covered
 * through a react-virtuoso stub that executes itemContent/endReached
 * directly — happy-dom cannot give Virtuoso a viewport, so this is the only
 * way those callbacks run under test. Per-entry rendering is covered by
 * FavoriteItem.test.tsx.
 */

import type { FavoriteVideo } from '@/features/favorite/types'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import FavoriteList from './FavoriteList'

// Minimal Virtuoso stand-in: renders every item through itemContent and
// fires endReached once so the infinite-scroll guard is exercised.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
    endReached,
  }: {
    data: unknown[]
    itemContent: (index: number, item: unknown) => React.ReactNode
    endReached?: () => void
  }) => {
    // Defer so React has committed the list before the callback fires.
    Promise.resolve().then(() => endReached?.())
    return (
      <div data-virtuoso-scroller>
        {data.map((item, i) => (
          <div key={i}>{itemContent(i, item)}</div>
        ))}
      </div>
    )
  },
}))

const video = (title: string): FavoriteVideo => ({
  id: 1,
  bvid: 'BV1xx411c7XD',
  page: 1,
  title,
  cover: '',
  duration: 125,
  attr: 0,
  link: 'https://www.bilibili.com/video/BV1x',
  playCount: 10,
  collectCount: 2,
  upper: { mid: 1, name: 'uploader', face: '' },
})

function renderList(
  overrides: Partial<Parameters<typeof FavoriteList>[0]> = {},
) {
  const onLoadMore = vi.fn()
  const onDownload = vi.fn()
  const utils = renderWithProviders(
    <FavoriteList
      videos={[video('First'), video('Second')]}
      loading={false}
      foldersLoading={false}
      hasMore={false}
      onLoadMore={onLoadMore}
      onDownload={onDownload}
      {...overrides}
    />,
  )
  return { ...utils, onLoadMore, onDownload }
}

describe('FavoriteList', () => {
  it('shows the loading indicator while videos are still loading', () => {
    const { container } = renderList({ loading: true })

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByText('favorite.empty')).toBeNull()
  })

  it('shows the loading indicator while folders are still loading', () => {
    const { container } = renderList({ foldersLoading: true })

    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('shows the empty state when there are no videos', () => {
    renderList({ videos: [] })

    expect(screen.getByText('favorite.empty')).toBeInTheDocument()
  })

  it('renders every entry and requests more pages at the end', async () => {
    const { onLoadMore } = renderList({ hasMore: true })

    // itemContent executed for each entry through the Virtuoso stub
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    // endReached fired with hasMore && !loading
    await vi.waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1))
  })

  it('does not request more pages while already loading', async () => {
    const { onLoadMore } = renderList({ hasMore: true, loading: true })

    expect(screen.getByText('First')).toBeInTheDocument()
    // The stub's endReached is deferred; give it a tick to (not) fire.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does not request more pages when hasMore is false', async () => {
    const { onLoadMore } = renderList({ hasMore: false })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onLoadMore).not.toHaveBeenCalled()
  })
})
