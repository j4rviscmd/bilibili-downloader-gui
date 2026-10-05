import { renderWithProviders } from '@/test/test-utils'
import { act, screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSearchHistoryApi,
  getSearchHistoryApi,
  recordSearchApi,
  removeSearchHistoryApi,
} from '../api/searchHistory'
import { searchSuggestApi } from '../api/searchSuggest'
import { searchTrendingApi } from '../api/searchTrending'
import { VideoSearchInput } from './VideoSearchInput'

vi.mock('../api/searchSuggest', () => ({
  searchSuggestApi: vi.fn(),
}))
vi.mock('../api/searchHistory', () => ({
  getSearchHistoryApi: vi.fn(),
  recordSearchApi: vi.fn(),
  removeSearchHistoryApi: vi.fn(),
  clearSearchHistoryApi: vi.fn(),
}))
vi.mock('../api/searchTrending', () => ({
  searchTrendingApi: vi.fn(),
}))

const PLACEHOLDER = 'videoSearch.placeholder'

function setup(onSearch = vi.fn()) {
  return {
    onSearch,
    ...renderWithProviders(
      <VideoSearchInput onSearch={onSearch} loading={false} />,
    ),
  }
}

async function typeAndSuggest(
  user: Awaited<ReturnType<typeof setup>['user']>,
  text: string,
) {
  vi.mocked(searchSuggestApi).mockResolvedValue(['少年', '少年法'])
  await user.type(screen.getByRole('combobox', { name: PLACEHOLDER }), text)
  await act(async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
  })
}

beforeEach(() => {
  // Defaults keep suggest-mode tests (and submit's fire-and-forget record)
  // from touching the panel APIs with undefined results.
  vi.mocked(getSearchHistoryApi).mockResolvedValue([])
  vi.mocked(searchTrendingApi).mockResolvedValue([])
  vi.mocked(recordSearchApi).mockResolvedValue(undefined)
  vi.mocked(removeSearchHistoryApi).mockResolvedValue([])
  vi.mocked(clearSearchHistoryApi).mockResolvedValue(undefined)
})

describe('VideoSearchInput suggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('fetches suggestions after the debounce and renders the listbox', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')

    expect(searchSuggestApi).toHaveBeenCalledWith('少年')
    const input = screen.getByRole('combobox', { name: PLACEHOLDER })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '少年法' })).toBeInTheDocument()
  })

  it('does not fetch for blank drafts', async () => {
    const { user } = setup()
    await user.type(screen.getByRole('combobox', { name: PLACEHOLDER }), '   ')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(searchSuggestApi).not.toHaveBeenCalled()
  })

  it('navigates with arrows and Enter picks the active suggestion', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    await typeAndSuggest(user, '少年')

    const input = screen.getByRole('combobox', { name: PLACEHOLDER })
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')

    expect(onSearch).toHaveBeenCalledWith('少年')
    expect(input).toHaveValue('少年')
  })

  it('clicking an option searches it and fills the input', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    await typeAndSuggest(user, '少年')

    await user.click(screen.getByRole('option', { name: '少年法' }))
    expect(onSearch).toHaveBeenCalledWith('少年法')
    expect(screen.getByRole('combobox', { name: PLACEHOLDER })).toHaveValue(
      '少年法',
    )
  })

  it('clicking an option does not re-suggest the committed keyword', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')

    vi.mocked(searchSuggestApi).mockClear()
    await user.click(screen.getByRole('option', { name: '少年法' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(searchSuggestApi).not.toHaveBeenCalled()
    const input = screen.getByRole('combobox', { name: PLACEHOLDER })
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Enter-picking a suggestion does not re-suggest it', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')

    vi.mocked(searchSuggestApi).mockClear()
    await user.keyboard('{ArrowDown}{Enter}')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(searchSuggestApi).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('focusing the input re-suggests for the current value', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')
    await user.click(screen.getByRole('option', { name: '少年法' }))
    // Leave the input, then come back: the list must reappear for the
    // committed keyword.
    await user.click(document.body)
    vi.mocked(searchSuggestApi).mockClear()
    vi.mocked(searchSuggestApi).mockResolvedValue(['少年法 ライブ'])
    await user.click(screen.getByRole('combobox', { name: PLACEHOLDER }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(searchSuggestApi).toHaveBeenCalledWith('少年法')
    expect(
      screen.getByRole('option', { name: '少年法 ライブ' }),
    ).toBeInTheDocument()
  })

  it('blurs the input when a search fires', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')

    await user.keyboard('{Enter}')
    expect(
      screen.getByRole('combobox', { name: PLACEHOLDER }),
    ).not.toHaveFocus()
  })

  it('Enter without an active option submits the raw draft', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    await typeAndSuggest(user, '少年')

    await user.keyboard('{Enter}')
    expect(onSearch).toHaveBeenCalledWith('少年')
  })

  it('Escape closes the dropdown without searching', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    await typeAndSuggest(user, '少年')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('ignores stale suggest responses', async () => {
    const { user } = setup()
    const input = screen.getByRole('combobox', { name: PLACEHOLDER })

    // Deferred manual promise: Promise.withResolvers needs lib es2024 and
    // the repo targets ES2022.
    let resolveFirst!: (v: string[]) => void
    vi.mocked(searchSuggestApi)
      .mockReturnValueOnce(
        new Promise<string[]>((r) => {
          resolveFirst = r
        }),
      )
      .mockResolvedValue(['新しい候補'])
    await user.type(input, 'a')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await user.type(input, 'b')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    // The first (stale) response lands after the second one: it must be
    // discarded, not clobber the fresh list.
    resolveFirst(['古い候補'])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(
      screen.getByRole('option', { name: '新しい候補' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: '古い候補' }),
    ).not.toBeInTheDocument()
  })

  it('discards in-flight suggestions when the input clears', async () => {
    const { user } = setup()
    const input = screen.getByRole('combobox', { name: PLACEHOLDER })

    // Deferred manual promise: Promise.withResolvers needs lib es2024 and
    // the repo targets ES2022.
    let resolveFirst!: (v: string[]) => void
    vi.mocked(searchSuggestApi)
      .mockReturnValueOnce(
        new Promise<string[]>((r) => {
          resolveFirst = r
        }),
      )
      .mockResolvedValue([])
    await user.type(input, 'a')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await user.clear(input)
    // The response for "a" lands after the input cleared: it must not
    // re-open the listbox over an empty input.
    resolveFirst(['古い候補'])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

const HISTORY = [
  { keyword: '洛天依', searchedAt: '2026-10-05T00:00:00Z', useCount: 2 },
  { keyword: 'VOCALOID', searchedAt: '2026-10-04T00:00:00Z', useCount: 1 },
]
const TRENDING = [{ keyword: 'KPL', showName: '北京JDG vs 杭州LGD KPL' }]

function mockPanels({
  history = HISTORY,
  trending = TRENDING,
}: {
  history?: typeof HISTORY
  trending?: typeof TRENDING
} = {}) {
  vi.mocked(getSearchHistoryApi).mockResolvedValue(history)
  vi.mocked(searchTrendingApi).mockResolvedValue(trending)
}

// Double-nested act: settles the panel promise chains (API mock → then →
// React state) the same way typeAndSuggest settles timer-driven updates.
// Also used with fake timers (trending-cache describe): promises settle on
// microtasks, only the clock is faked.
async function flushPanelUpdates() {
  await act(async () => {
    await act(async () => {})
  })
}

async function focusBlank(user: UserEvent) {
  await user.click(screen.getByRole('combobox', { name: PLACEHOLDER }))
  await flushPanelUpdates()
}

describe('VideoSearchInput blank-input panels', () => {
  // Why: unlike the suggestions describe, these tests assert on call counts
  // (not-to-be-called) — mock calls must not leak across tests.
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('blank focus shows history and trending panels', async () => {
    const { user } = setup()
    mockPanels()

    await focusBlank(user)

    expect(getSearchHistoryApi).toHaveBeenCalled()
    expect(searchTrendingApi).toHaveBeenCalled()
    expect(screen.getByText('videoSearch.searchHistory')).toBeInTheDocument()
    expect(screen.getByText('videoSearch.trending')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '洛天依' })).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: '北京JDG vs 杭州LGD KPL' }),
    ).toBeInTheDocument()
  })

  it('clicking a history keyword searches and records it', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    mockPanels()
    await focusBlank(user)

    await user.click(screen.getByRole('option', { name: '洛天依' }))

    expect(onSearch).toHaveBeenCalledWith('洛天依')
    expect(recordSearchApi).toHaveBeenCalledWith('洛天依')
    expect(screen.getByRole('combobox', { name: PLACEHOLDER })).toHaveValue(
      '洛天依',
    )
  })

  it('arrow navigation crosses from history into trending and Enter picks the keyword', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    mockPanels()
    await focusBlank(user)

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onSearch).toHaveBeenCalledWith('KPL')
    expect(screen.getByRole('combobox', { name: PLACEHOLDER })).toHaveValue(
      'KPL',
    )
  })

  it('Delete removes the active history row and refreshes the panel', async () => {
    const { user } = setup()
    mockPanels()
    await focusBlank(user)
    vi.mocked(removeSearchHistoryApi).mockResolvedValue([HISTORY[1]])

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Delete}')
    await flushPanelUpdates()

    expect(removeSearchHistoryApi).toHaveBeenCalledWith('洛天依')
    expect(
      screen.queryByRole('option', { name: '洛天依' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VOCALOID' })).toBeInTheDocument()
  })

  it('Backspace removes the active history row on a blank draft (Apple keyboards)', async () => {
    const { user } = setup()
    mockPanels()
    await focusBlank(user)
    vi.mocked(removeSearchHistoryApi).mockResolvedValue([HISTORY[1]])

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Backspace}')
    await flushPanelUpdates()

    expect(removeSearchHistoryApi).toHaveBeenCalledWith('洛天依')
  })

  it('Backspace on a whitespace-only draft erases the character, not the row', async () => {
    // hasDraft is trim-based, so ' ' shows the panels; Backspace must still
    // edit text (it has a character to erase), never delete the active row.
    const { user } = setup()
    mockPanels()
    await focusBlank(user)

    await user.type(screen.getByRole('combobox', { name: PLACEHOLDER }), ' ')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Backspace}')
    await flushPanelUpdates()

    expect(removeSearchHistoryApi).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: PLACEHOLDER })).toHaveValue('')
  })

  it('clear-all empties the history section but keeps trending', async () => {
    const { user } = setup()
    mockPanels()
    await focusBlank(user)

    await user.click(screen.getByText('videoSearch.clearHistory'))
    await flushPanelUpdates()

    expect(clearSearchHistoryApi).toHaveBeenCalled()
    expect(
      screen.queryByRole('option', { name: '洛天依' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: '北京JDG vs 杭州LGD KPL' }),
    ).toBeInTheDocument()
  })

  it('a trending failure degrades to a history-only panel', async () => {
    const { user } = setup()
    vi.mocked(getSearchHistoryApi).mockResolvedValue(HISTORY)
    vi.mocked(searchTrendingApi).mockRejectedValue(new Error('net'))

    await focusBlank(user)

    expect(screen.getByText('videoSearch.searchHistory')).toBeInTheDocument()
    expect(screen.queryByText('videoSearch.trending')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VOCALOID' })).toBeInTheDocument()
  })

  it('a trending response landing after history still renders', async () => {
    // Regression: the draft effect re-runs when a panel load settles; an
    // unconditional stale-round bump there dropped the slower trending
    // fetch (history is a local read and always wins the race).
    const { user } = setup()
    // Deferred manual promise: Promise.withResolvers needs lib es2024 and
    // the repo targets ES2022.
    let resolveTrending!: (v: typeof TRENDING) => void
    vi.mocked(getSearchHistoryApi).mockResolvedValue(HISTORY)
    vi.mocked(searchTrendingApi).mockReturnValue(
      new Promise<typeof TRENDING>((r) => {
        resolveTrending = r
      }),
    )

    await focusBlank(user)
    // History landed and its effect re-ran while trending was still pending.
    expect(screen.getByRole('option', { name: 'VOCALOID' })).toBeInTheDocument()

    await act(async () => {
      resolveTrending(TRENDING)
    })

    expect(
      screen.getByRole('option', { name: '北京JDG vs 杭州LGD KPL' }),
    ).toBeInTheDocument()
  })

  it('a history failure degrades to a trending-only panel', async () => {
    const { user } = setup()
    vi.mocked(getSearchHistoryApi).mockRejectedValue(new Error('io'))
    vi.mocked(searchTrendingApi).mockResolvedValue(TRENDING)

    await focusBlank(user)

    expect(screen.getByText('videoSearch.trending')).toBeInTheDocument()
    expect(
      screen.queryByText('videoSearch.searchHistory'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: '北京JDG vs 杭州LGD KPL' }),
    ).toBeInTheDocument()
  })

  it('renders no listbox when both panels come back empty', async () => {
    const { user } = setup()
    mockPanels({ history: [], trending: [] })

    await focusBlank(user)

    expect(screen.getByRole('combobox', { name: PLACEHOLDER })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('deleting the draft mid-focus falls back to the panels', async () => {
    const { user } = setup()
    mockPanels()
    vi.mocked(searchSuggestApi).mockResolvedValue([])
    await focusBlank(user)

    const input = screen.getByRole('combobox', { name: PLACEHOLDER })
    await user.type(input, 'a')
    await user.clear(input)
    await flushPanelUpdates()

    // Draft blank again → the flat list swaps back to history + trending.
    expect(screen.getByRole('option', { name: '洛天依' })).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: '北京JDG vs 杭州LGD KPL' }),
    ).toBeInTheDocument()
  })

  it('a stale focus-time history fetch landing after Delete does not resurrect the row', async () => {
    const { user } = setup()
    mockPanels()
    await focusBlank(user)

    // Refocus fires a fresh history fetch that stays in flight past the
    // remove: the round guard bumped by removeHistoryItem must discard it.
    let resolveSecond!: (v: typeof HISTORY) => void
    vi.mocked(getSearchHistoryApi).mockReturnValueOnce(
      new Promise<typeof HISTORY>((r) => {
        resolveSecond = r
      }),
    )
    await user.click(document.body)
    await user.click(screen.getByRole('combobox', { name: PLACEHOLDER }))

    vi.mocked(removeSearchHistoryApi).mockResolvedValue([HISTORY[1]])
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Delete}')
    await flushPanelUpdates()

    expect(removeSearchHistoryApi).toHaveBeenCalledWith('洛天依')
    expect(
      screen.queryByRole('option', { name: '洛天依' }),
    ).not.toBeInTheDocument()

    // The in-flight fetch resolves with the full list afterwards: stale,
    // so the removed row must stay gone.
    await act(async () => {
      resolveSecond(HISTORY)
    })
    await flushPanelUpdates()
    expect(
      screen.queryByRole('option', { name: '洛天依' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VOCALOID' })).toBeInTheDocument()
  })

  it('a stale focus-time history fetch landing after clear-all does not resurrect rows', async () => {
    const { user } = setup()
    mockPanels()
    await focusBlank(user)

    // Same guard as the Delete path, but for the clear-all button's own
    // round bump.
    let resolveSecond!: (v: typeof HISTORY) => void
    vi.mocked(getSearchHistoryApi).mockReturnValueOnce(
      new Promise<typeof HISTORY>((r) => {
        resolveSecond = r
      }),
    )
    await user.click(document.body)
    await user.click(screen.getByRole('combobox', { name: PLACEHOLDER }))

    await user.click(screen.getByText('videoSearch.clearHistory'))
    await flushPanelUpdates()

    expect(clearSearchHistoryApi).toHaveBeenCalled()
    expect(
      screen.queryByRole('option', { name: '洛天依' }),
    ).not.toBeInTheDocument()

    await act(async () => {
      resolveSecond(HISTORY)
    })
    await flushPanelUpdates()
    expect(
      screen.queryByRole('option', { name: '洛天依' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: '北京JDG vs 杭州LGD KPL' }),
    ).toBeInTheDocument()
  })
})

describe('VideoSearchInput trending cache', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does not refetch trending while the cache window holds', async () => {
    const { user } = setup()
    mockPanels()

    await focusBlank(user)
    await user.click(document.body)
    // 4 minutes later — well inside the 5-minute cache window (not exactly
    // 1ms before the boundary: shouldAdvanceTime adds stray clock ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000)
    })
    await focusBlank(user)

    expect(searchTrendingApi).toHaveBeenCalledTimes(1)
    // Cached data still renders on the refocused panel.
    expect(
      screen.getByRole('option', { name: '北京JDG vs 杭州LGD KPL' }),
    ).toBeInTheDocument()
  })

  it('refetches trending once the cache window expires', async () => {
    const { user } = setup()
    mockPanels()

    await focusBlank(user)
    await user.click(document.body)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    await focusBlank(user)

    expect(searchTrendingApi).toHaveBeenCalledTimes(2)
    expect(
      screen.getByRole('option', { name: '北京JDG vs 杭州LGD KPL' }),
    ).toBeInTheDocument()
  })
})
