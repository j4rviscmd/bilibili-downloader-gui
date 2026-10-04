/**
 * VideoSearchFilterBar suite.
 *
 * Covers the three labeled selects (order / duration / zone), the
 * pre-first-search disabled state, and the onValueChange → setFilter wiring
 * through a real Radix Select open-and-pick (happy-dom pointer stub, same
 * pattern as the shared Select suite).
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { VideoSearchView } from '../hooks/useVideoSearch'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'
import { VideoSearchFilterBar } from './VideoSearchFilterBar'

vi.mock('../hooks/useVideoSearch', () => ({
  useVideoSearch: vi.fn(),
}))

beforeAll(() => {
  // Radix Select calls these pointer APIs on open; happy-dom lacks them.
  const stub = (name: string, impl: () => unknown) => {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, {
        value: impl,
        configurable: true,
      })
    }
  }
  stub('hasPointerCapture', () => false)
  stub('setPointerCapture', () => {})
  stub('releasePointerCapture', () => {})
})

const setFilter = vi.fn()

/** Raw i18n keys — the suite runs without loaded translations. */
const ORDER_LABEL = 'videoSearch.filters.orderLabel'
const DURATION_LABEL = 'videoSearch.filters.durationLabel'
const ZONE_LABEL = 'videoSearch.filters.zoneLabel'

function mockState(overrides: Partial<VideoSearchView>) {
  vi.mocked(useVideoSearch).mockReturnValue({
    keyword: 'kw',
    page: 1,
    filters: DEFAULT_VIDEO_SEARCH_FILTERS,
    numPages: 2,
    numResults: 40,
    entries: [],
    loading: false,
    error: null,
    search: vi.fn(),
    goToPage: vi.fn(),
    setFilter,
    ...overrides,
  })
}

describe('VideoSearchFilterBar', () => {
  it('renders the three labeled selects with the current values', () => {
    mockState({})
    renderWithProviders(<VideoSearchFilterBar />)

    // Labels associate via htmlFor → the triggers answer to them.
    expect(
      screen.getByRole('combobox', { name: ORDER_LABEL }),
    ).toHaveTextContent('videoSearch.filters.order.totalrank')
    expect(
      screen.getByRole('combobox', { name: DURATION_LABEL }),
    ).toHaveTextContent('videoSearch.filters.duration.all')
    expect(
      screen.getByRole('combobox', { name: ZONE_LABEL }),
    ).toHaveTextContent('videoSearch.zones.all')
    // Result count rides the same row (raw key in tests).
    expect(screen.getByText('videoSearch.resultsCount')).toBeInTheDocument()
  })

  it('disables every select before the first search (no keyword yet)', () => {
    mockState({ keyword: '', numResults: 0 })
    renderWithProviders(<VideoSearchFilterBar />)

    for (const label of [ORDER_LABEL, DURATION_LABEL, ZONE_LABEL]) {
      expect(screen.getByRole('combobox', { name: label })).toBeDisabled()
    }
    // No results yet → no count text on the row.
    expect(
      screen.queryByText('videoSearch.resultsCount'),
    ).not.toBeInTheDocument()
  })

  it('picking a zone reports the tid through setFilter', async () => {
    mockState({})
    const { user } = renderWithProviders(<VideoSearchFilterBar />)

    await user.click(screen.getByRole('combobox', { name: ZONE_LABEL }))
    // Raw zone key for tid=4 (game).
    await user.click(
      screen.getByRole('option', { name: 'videoSearch.zones.game' }),
    )

    expect(setFilter).toHaveBeenCalledWith({ tids: 4 })
  })

  it('picking a duration bucket reports the numeric value', async () => {
    mockState({})
    const { user } = renderWithProviders(<VideoSearchFilterBar />)

    await user.click(screen.getByRole('combobox', { name: DURATION_LABEL }))
    await user.click(
      screen.getByRole('option', {
        name: 'videoSearch.filters.duration.min10to30',
      }),
    )

    expect(setFilter).toHaveBeenCalledWith({ duration: 2 })
  })
})
