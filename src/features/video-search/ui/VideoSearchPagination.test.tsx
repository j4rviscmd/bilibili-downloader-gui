import { renderWithProviders } from '@/test/test-utils'
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VideoSearchView } from '../hooks/useVideoSearch'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import { VideoSearchPagination } from './VideoSearchPagination'

vi.mock('../hooks/useVideoSearch', () => ({
  useVideoSearch: vi.fn(),
}))

// Tests run without loaded translations, so labels are raw keys.
const PREV = 'videoSearch.prevPage'
const NEXT = 'videoSearch.nextPage'

function mockState(
  page: number,
  numPages: number,
  goToPage = vi.fn(),
  loading = false,
) {
  const view: VideoSearchView = {
    keyword: 'kw',
    page,
    numPages,
    filters: DEFAULT_VIDEO_SEARCH_FILTERS,
    numResults: 40,
    entries: [],
    loading,
    error: null,
    search: vi.fn(),
    goToPage,
    searchStarted: true,
    setFilter: vi.fn(),
  }
  vi.mocked(useVideoSearch).mockReturnValue(view)
  return goToPage
}

/**
 * Page-number element query. shadcn PaginationLink renders an <a> without
 * href (no implicit link role), so query by its exact text instead.
 */
const pageItem = (n: number) => screen.getByText(String(n))

describe('VideoSearchPagination', () => {
  it('renders all page numbers for small page counts', () => {
    mockState(2, 5)
    renderWithProviders(<VideoSearchPagination />)
    ;[1, 2, 3, 4, 5].forEach((n) => expect(pageItem(n)).toBeInTheDocument())
    // Ellipsis renders as an icon with an sr-only "More pages" label.
    expect(screen.queryByText('More pages')).not.toBeInTheDocument()
  })

  it('collapses large page counts with ellipsis around the current page', () => {
    mockState(6, 50)
    renderWithProviders(<VideoSearchPagination />)
    // Window: 1 … 5 6 7 … 50
    ;[1, 5, 6, 7, 50].forEach((n) => expect(pageItem(n)).toBeInTheDocument())
    ;[2, 8, 49].forEach((n) =>
      expect(screen.queryByText(String(n))).not.toBeInTheDocument(),
    )
    expect(screen.getAllByText('More pages').length).toBeGreaterThan(0)
  })

  it('marks the current page active', () => {
    mockState(2, 5)
    renderWithProviders(<VideoSearchPagination />)
    expect(pageItem(2).closest('a')).toHaveAttribute('aria-current', 'page')
    expect(pageItem(3).closest('a')).not.toHaveAttribute('aria-current')
  })

  it('navigates to a clicked page number', async () => {
    const goToPage = mockState(1, 5)
    const { user } = renderWithProviders(<VideoSearchPagination />)
    await user.click(pageItem(4))
    expect(goToPage).toHaveBeenCalledWith(4)
  })

  it('prev and next navigate from a middle page; bound clicks clamp', async () => {
    const goToPage = mockState(3, 5)
    const { user } = renderWithProviders(<VideoSearchPagination />)
    await user.click(screen.getByText(PREV))
    await user.click(screen.getByText(NEXT))
    expect(goToPage).toHaveBeenCalledWith(2)
    expect(goToPage).toHaveBeenCalledWith(4)

    // At page 1 the prev click clamps to page 1 (Math.max guard) — never 0.
    const goToPageFirst = mockState(1, 5)
    const { user: firstUser, container } = renderWithProviders(
      <VideoSearchPagination />,
    )
    // Why: RTL keeps the first render mounted until afterEach cleanup, so a
    // screen.getByText(PREV) here would match both — scope to the container.
    await firstUser.click(within(container).getByText(PREV))
    expect(goToPageFirst).toHaveBeenCalledWith(1)
    expect(goToPageFirst).not.toHaveBeenCalledWith(0)
  })

  it('hides itself for single-page and pre-search states', () => {
    mockState(1, 1)
    const { container } = renderWithProviders(<VideoSearchPagination />)
    expect(container).toBeEmptyDOMElement()

    mockState(1, 0)
    const { container: pre } = renderWithProviders(<VideoSearchPagination />)
    expect(pre).toBeEmptyDOMElement()
  })
})
