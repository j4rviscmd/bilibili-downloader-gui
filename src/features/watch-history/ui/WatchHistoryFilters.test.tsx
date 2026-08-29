/**
 * WatchHistoryFilters suite.
 *
 * Date-filter Select: the picked option reports through onChange.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { WatchHistoryFilters } from './WatchHistoryFilters'

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

describe('WatchHistoryFilters', () => {
  it('reports the picked date filter through onChange', async () => {
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <WatchHistoryFilters value="all" onChange={onChange} />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(
      screen.getByRole('option', { name: 'watchHistory.filter.week' }),
    )

    expect(onChange).toHaveBeenCalledWith('week')
  })

  it('lists all four date filter options when opened', async () => {
    const { user } = renderWithProviders(
      <WatchHistoryFilters value="all" onChange={vi.fn()} />,
    )

    await user.click(screen.getByRole('combobox'))

    expect(
      screen.getByRole('option', { name: 'watchHistory.filter.all' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'watchHistory.filter.today' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'watchHistory.filter.week' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'watchHistory.filter.month' }),
    ).toBeInTheDocument()
  })
})
