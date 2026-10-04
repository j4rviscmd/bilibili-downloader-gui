import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VideoSearchView } from '../hooks/useVideoSearch'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import { VideoSearchResultList } from './VideoSearchResultList'

vi.mock('../hooks/useVideoSearch', () => ({
  useVideoSearch: vi.fn(),
}))
vi.mock('@/shared/hooks/usePendingDownload', () => ({
  usePendingDownload: vi.fn(),
}))

const baseState: VideoSearchView = {
  keyword: 'kw',
  page: 1,
  filters: DEFAULT_VIDEO_SEARCH_FILTERS,
  numPages: 2,
  numResults: 40,
  loading: false,
  error: null,
  entries: [
    {
      bvid: 'BV1De411p77r',
      title: '少年 官方版',
      cover: 'https://i0.hdslb.com/bfs/archive/x.jpg',
      author: 'up主',
      play: 1037655,
      duration: 287,
      // Sub-zone tid (MV → music) — badge localizes via the zone map.
      typeid: '193',
      typename: 'MV',
    },
    {
      // Unknown tid — badge falls back to the raw API typename.
      bvid: 'BV1unknown9xx',
      title: '未知分区 動画',
      cover: 'https://i0.hdslb.com/bfs/archive/y.jpg',
      author: '別UP',
      play: 1,
      duration: 10,
      typeid: '9999',
      typename: '未知分区',
    },
    {
      // Empty zone data — the badge renders nothing (hidden, not blank).
      bvid: 'BV1nozone',
      title: '無バッジ 動画',
      cover: 'https://i0.hdslb.com/bfs/archive/z.jpg',
      author: '第三UP',
      play: 2,
      duration: 33,
      typeid: '',
      typename: '',
    },
  ],
  search: vi.fn(),
  goToPage: vi.fn(),
  setFilter: vi.fn(),
}

describe('VideoSearchResultList', () => {
  it('renders entry fields and click hands off to the download flow', async () => {
    vi.mocked(useVideoSearch).mockReturnValue(baseState)
    const handleDownload = vi.fn()
    vi.mocked(usePendingDownload).mockReturnValue(handleDownload)

    const { user } = renderWithProviders(<VideoSearchResultList />)

    expect(screen.getByText('少年 官方版')).toBeInTheDocument()
    expect(screen.getByText('up主')).toBeInTheDocument()
    // Zone badges: known sub-zone tid localizes (raw key in tests), the
    // unknown-tid entry falls back to the raw API typename.
    expect(screen.getByText('videoSearch.zones.music')).toBeInTheDocument()
    expect(screen.getByText('未知分区')).toBeInTheDocument()
    // Empty zone data hides the badge entirely — exactly two badges render.
    expect(
      screen.getAllByText(/^videoSearch\.zones\.|^未知分区$/),
    ).toHaveLength(2)
    // Duration renders as a thumbnail overlay badge (media-card convention).
    expect(screen.getByText('4:47')).toBeInTheDocument()
    expect(screen.getByText('1,037,655')).toBeInTheDocument()
    // Why: hdslb.com 403s cross-origin referers — the no-referrer policy is
    // what makes covers load (regression: initial release shipped without
    // it). alt="" makes the img presentational (no role), so query directly.
    expect(document.querySelector('img')).toHaveAttribute(
      'referrerPolicy',
      'no-referrer',
    )
    await user.click(screen.getByRole('button', { name: /少年 官方版/ }))
    // Favorites pattern: no cid — resolved later by the URL search page.
    expect(handleDownload).toHaveBeenCalledWith('BV1De411p77r', null, 1)
  })

  it('renders card skeletons with an accessible busy state while loading', () => {
    vi.mocked(useVideoSearch).mockReturnValue({ ...baseState, loading: true })
    const { container } = renderWithProviders(<VideoSearchResultList />)

    // Skeletons are aria-hidden decoration; the busy text carries the state.
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.getByText('videoSearch.loading')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      0,
    )
    expect(
      screen.queryByRole('button', { name: /少年/ }),
    ).not.toBeInTheDocument()
  })

  it('renders the no-results state with a hint after searching', () => {
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      entries: [],
      numResults: 0,
    })
    renderWithProviders(<VideoSearchResultList />)
    // i18n test setup returns raw keys.
    expect(screen.getByText('videoSearch.noResults')).toBeInTheDocument()
    expect(screen.getByText('videoSearch.noResultsHint')).toBeInTheDocument()
  })

  it('renders the prompt placeholder state before any search', () => {
    vi.mocked(useVideoSearch).mockReturnValue({
      ...baseState,
      keyword: '',
      entries: [],
      numResults: 0,
    })
    renderWithProviders(<VideoSearchResultList />)
    expect(screen.getByText('videoSearch.placeholder')).toBeInTheDocument()
    expect(
      screen.queryByText('videoSearch.noResultsHint'),
    ).not.toBeInTheDocument()
  })
})
