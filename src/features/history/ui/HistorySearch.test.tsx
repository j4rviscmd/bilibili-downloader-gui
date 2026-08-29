/**
 * HistorySearch suite.
 *
 * Controlled input: typing propagates through onChange; placeholder comes
 * from the identity t mock.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import HistorySearch from './HistorySearch'

describe('HistorySearch', () => {
  it('renders the seeded value and localized placeholder', () => {
    renderWithProviders(<HistorySearch value="initial" onChange={vi.fn()} />)

    const input = screen.getByPlaceholderText('history.searchPlaceholder')
    expect(input).toHaveValue('initial')
  })

  it('propagates every keystroke through onChange', async () => {
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <HistorySearch value="" onChange={onChange} />,
    )

    await user.type(
      screen.getByPlaceholderText('history.searchPlaceholder'),
      'abc',
    )

    expect(onChange).toHaveBeenLastCalledWith('c')
    expect(onChange).toHaveBeenCalledTimes(3)
  })
})
