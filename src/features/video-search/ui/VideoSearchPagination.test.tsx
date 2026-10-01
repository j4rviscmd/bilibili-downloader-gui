import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VideoSearchView } from '../hooks/useVideoSearch'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { VideoSearchPagination } from './VideoSearchPagination'

vi.mock('../hooks/useVideoSearch', () => ({
  useVideoSearch: vi.fn(),
}))

// Tests run without loaded translations, so accessible names are raw keys.
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
    numResults: 40,
    entries: [],
    loading,
    error: null,
    search: vi.fn(),
    goToPage,
  }
  vi.mocked(useVideoSearch).mockReturnValue(view)
  return goToPage
}

describe('VideoSearchPagination', () => {
  it('disables prev on page 1 and next on the last page', () => {
    mockState(1, 1)
    renderWithProviders(<VideoSearchPagination />)
    expect(screen.getByRole('button', { name: PREV })).toBeDisabled()
    expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()
  })

  it('navigates to adjacent pages', async () => {
    const goToPage = mockState(2, 3)
    const { user } = renderWithProviders(<VideoSearchPagination />)
    await user.click(screen.getByRole('button', { name: PREV }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    expect(goToPage).toHaveBeenCalledWith(1)
    expect(goToPage).toHaveBeenCalledWith(3)
  })

  it('disables both buttons while a search is in flight', () => {
    mockState(2, 3, vi.fn(), true)
    renderWithProviders(<VideoSearchPagination />)
    expect(screen.getByRole('button', { name: PREV })).toBeDisabled()
    expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()
  })

  it('hides itself without results', () => {
    mockState(1, 0)
    const { container } = renderWithProviders(<VideoSearchPagination />)
    expect(container).toBeEmptyDOMElement()
  })
})
