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

const SKELETON = '[data-slot="skeleton"]'

// Minimal Virtuoso stand-in: renders every item through itemContent,
// mounts the Footer component and fires endReached once so the
// infinite-scroll guard is exercised.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
    endReached,
    components,
    customScrollParent,
    style,
  }: {
    data: unknown[]
    itemContent: (index: number, item: unknown) => React.ReactNode
    endReached?: () => void
    components?: { Footer?: () => React.ReactNode }
    customScrollParent?: HTMLElement | undefined
    style?: { height?: string } | undefined
  }) => {
    // Defer so React has committed the list before the callback fires.
    Promise.resolve().then(() => endReached?.())
    const Footer = components?.Footer
    return (
      <div
        data-virtuoso-scroller
        data-rides-scroll-parent={customScrollParent ? 'yes' : 'no'}
        data-own-height={style?.height ?? 'unset'}
      >
        {data.map((item, i) => (
          <div key={i}>{itemContent(i, item)}</div>
        ))}
        {Footer ? <Footer /> : null}
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
      scrollParent={null}
      {...overrides}
    />,
  )
  return { ...utils, onLoadMore, onDownload }
}

describe('FavoriteList', () => {
  it('shows a skeleton while videos are still loading', () => {
    const { container } = renderList({ videos: [], loading: true })

    expect(container.querySelector(SKELETON)).toBeInTheDocument()
    expect(screen.getByText('favorite.loading')).toBeInTheDocument()
    expect(screen.queryByText('favorite.empty')).toBeNull()
  })

  it('shows a skeleton while folders are still loading', () => {
    const { container } = renderList({ videos: [], foldersLoading: true })

    expect(container.querySelector(SKELETON)).toBeInTheDocument()
  })

  it('shows the empty state when there are no videos', () => {
    const { container } = renderList({ videos: [] })

    expect(screen.getByText('favorite.empty')).toBeInTheDocument()
    // Whole-page scroll: the empty state carries its own min-height floor
    // instead of relying on a flex-constrained list region.
    expect(container.querySelector('.min-h-\\[400px\\]')).not.toBeNull()
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

  it('shows the footer skeleton only while loading more', () => {
    const props = {
      videos: [video('First')],
      loading: true,
      foldersLoading: false,
      hasMore: true,
      onLoadMore: vi.fn(),
      onDownload: vi.fn(),
      scrollParent: null,
    }
    const { rerender } = renderWithProviders(<FavoriteList {...props} />)

    const scroller = document.querySelector('[data-virtuoso-scroller]')!
    expect(scroller.lastElementChild?.querySelector(SKELETON)).not.toBeNull()

    rerender(<FavoriteList {...props} loading={false} />)

    expect(document.querySelector(SKELETON)).toBeNull()
    const settled = document.querySelector('[data-virtuoso-scroller]')!
    expect(settled.lastElementChild?.textContent).toContain('First')
  })

  it('rides the page scroll container via customScrollParent when provided', () => {
    const { container } = renderList({
      scrollParent: document.createElement('div'),
    })

    // The page-level container owns the scrolling: Virtuoso must not
    // bring its own scroller height in this mode.
    const scroller = container.querySelector('[data-virtuoso-scroller]')!
    expect(scroller).toHaveAttribute('data-rides-scroll-parent', 'yes')
    expect(scroller).toHaveAttribute('data-own-height', 'unset')
  })

  it('falls back to its own scroller height without a scroll parent', () => {
    const { container } = renderList()

    const scroller = container.querySelector('[data-virtuoso-scroller]')!
    expect(scroller).toHaveAttribute('data-rides-scroll-parent', 'no')
    expect(scroller).toHaveAttribute('data-own-height', '100%')
  })
})
