/**
 * WatchHistorySearch suite.
 *
 * Controlled input: typing propagates through onChange.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WatchHistorySearch } from './WatchHistorySearch'

describe('WatchHistorySearch', () => {
  it('renders the seeded value and localized placeholder', () => {
    renderWithProviders(
      <WatchHistorySearch value="initial" onChange={vi.fn()} />,
    )

    expect(screen.getByPlaceholderText('watchHistory.search')).toHaveValue(
      'initial',
    )
  })

  it('propagates every keystroke through onChange', async () => {
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <WatchHistorySearch value="" onChange={onChange} />,
    )

    await user.type(screen.getByPlaceholderText('watchHistory.search'), 'ab')

    expect(onChange).toHaveBeenLastCalledWith('b')
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})
