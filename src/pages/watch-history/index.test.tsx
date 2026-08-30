import { store } from '@/app/store'
import { setUser } from '@/features/user/userSlice'
import type { WatchHistoryEntry } from '@/features/watch-history'
import WatchHistoryContent from '@/pages/watch-history'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Feature leaves and the data hook are covered by their own F3/F4 tests;
// here they are stubbed so this file locks the page's wiring only.
vi.mock('@/features/watch-history/hooks/useWatchHistory', () => ({
  useWatchHistory: vi.fn(),
}))
vi.mock('@/features/watch-history/ui/WatchHistoryList', () => ({
  WatchHistoryList: (props: {
    entries: unknown[]
    hasMore: boolean
    disabled: boolean
    onDownload: (e: unknown) => void
  }) => (
    <div>
      <div data-testid="wh-list">
        count={props.entries.length} hasMore={String(props.hasMore)} disabled=
        {String(props.disabled)}
      </div>
      <button onClick={() => props.onDownload(mockEntry)}>download</button>
    </div>
  ),
}))
vi.mock('@/features/watch-history/ui/WatchHistoryFilters', () => ({
  WatchHistoryFilters: (props: {
    value: string
    onChange: (v: string) => void
  }) => (
    <button onClick={() => props.onChange('week')}>
      wh-filters:{props.value}
    </button>
  ),
}))
vi.mock('@/features/watch-history/ui/WatchHistorySearch', () => ({
  WatchHistorySearch: (props: {
    value: string
    onChange: (v: string) => void
  }) => (
    <button onClick={() => props.onChange('query')}>
      wh-search:{props.value}
    </button>
  ),
}))
vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { useWatchHistory } from '@/features/watch-history/hooks/useWatchHistory'
import { toast } from '@/shared/ui/toast'

/** A watch history entry passed through the mocked list's onDownload. */
const mockEntry = {
  bvid: 'BV1history',
  cid: 42,
  page: 3,
} as WatchHistoryEntry

function createMockUseWatchHistory(
  overrides: Partial<ReturnType<typeof useWatchHistory>> = {},
): ReturnType<typeof useWatchHistory> {
  return {
    entries: [],
    cursor: null,
    loading: false,
    loadingMore: false,
    error: null,
    searchQuery: '',
    dateFilter: 'all',
    fetchInitial: vi.fn(),
    fetchMore: vi.fn(),
    refresh: vi.fn(),
    setSearch: vi.fn(),
    setDate: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useWatchHistory>
}

function seedLoggedIn(loggedIn: boolean) {
  store.dispatch(
    setUser({
      code: 0,
      message: '',
      ttl: 0,
      data: {
        uname: loggedIn ? 'tester' : '',
        isLogin: loggedIn,
        wbiImg: { imgUrl: '', subUrl: '' },
      },
      hasCookie: loggedIn,
    }),
  )
}

describe('WatchHistoryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedLoggedIn(true)
    vi.mocked(useWatchHistory).mockReturnValue(createMockUseWatchHistory())
  })

  it('renders the login-required notice and skips fetching when logged out', () => {
    seedLoggedIn(false)
    const fetchInitial = vi.fn()
    vi.mocked(useWatchHistory).mockReturnValue(
      createMockUseWatchHistory({ fetchInitial }),
    )

    renderWithProviders(<WatchHistoryContent />, {
      route: '/watch-history',
    })

    expect(screen.getByText('watchHistory.loginRequired')).toBeInTheDocument()
    expect(fetchInitial).not.toHaveBeenCalled()
  })

  it('fetches initial history on mount when logged in and sets the title', () => {
    const fetchInitial = vi.fn()
    vi.mocked(useWatchHistory).mockReturnValue(
      createMockUseWatchHistory({ fetchInitial }),
    )

    renderWithProviders(<WatchHistoryContent />, {
      route: '/watch-history',
    })

    expect(fetchInitial).toHaveBeenCalledTimes(1)
    expect(screen.getByText('watchHistory.title')).toBeInTheDocument()
    expect(document.title).toBe('watchHistory.title - app.title')
  })

  it('wires search and date filters to the hook setters', async () => {
    const setSearch = vi.fn()
    const setDate = vi.fn()
    vi.mocked(useWatchHistory).mockReturnValue(
      createMockUseWatchHistory({
        searchQuery: 'kw',
        dateFilter: 'month',
        setSearch,
        setDate,
      }),
    )

    const { user } = renderWithProviders(<WatchHistoryContent />, {
      route: '/watch-history',
    })

    expect(screen.getByText('wh-search:kw')).toBeInTheDocument()
    expect(screen.getByText('wh-filters:month')).toBeInTheDocument()
    await user.click(screen.getByText('wh-search:kw'))
    expect(setSearch).toHaveBeenCalledWith('query')
    await user.click(screen.getByText('wh-filters:month'))
    expect(setDate).toHaveBeenCalledWith('week')
  })

  it('wires list props from the hook (entries, hasMore, download lock)', () => {
    vi.mocked(useWatchHistory).mockReturnValue(
      createMockUseWatchHistory({
        entries: [mockEntry, mockEntry],
        cursor: { isEnd: false } as never,
      }),
    )

    renderWithProviders(<WatchHistoryContent />, {
      route: '/watch-history',
    })

    expect(screen.getByTestId('wh-list')).toHaveTextContent('count=2')
    expect(screen.getByTestId('wh-list')).toHaveTextContent('hasMore=true')
    expect(screen.getByTestId('wh-list')).toHaveTextContent('disabled=false')
  })

  it('shows the error alert outside the list when the hook errored', () => {
    vi.mocked(useWatchHistory).mockReturnValue(
      createMockUseWatchHistory({ error: 'network down' }),
    )

    renderWithProviders(<WatchHistoryContent />, {
      route: '/watch-history',
    })

    expect(screen.getByText('network down')).toBeInTheDocument()
  })

  it('refresh button calls refresh and toasts success', async () => {
    const refresh = vi.fn()
    vi.mocked(useWatchHistory).mockReturnValue(
      createMockUseWatchHistory({ refresh }),
    )

    const { user } = renderWithProviders(<WatchHistoryContent />, {
      route: '/watch-history',
    })

    await user.click(screen.getByText('watchHistory.refresh'))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'watchHistory.refreshed',
    )
  })

  it('onDownload stores a pending download and navigates home', async () => {
    const { user } = renderWithProviders(<WatchHistoryContent />, {
      route: '/watch-history',
    })

    await user.click(screen.getByText('download'))

    expect(store.getState().input.pendingDownload).toEqual({
      bvid: 'BV1history',
      cid: 42,
      page: 3,
    })
  })
})
