/**
 * HistoryFilters suite.
 *
 * Status dropdown: trigger shows the current filter's label and menu
 * items report the chosen value through onChange.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import HistoryFilters from './HistoryFilters'

describe('HistoryFilters', () => {
  it('shows the current filter label on the trigger', () => {
    renderWithProviders(<HistoryFilters value="completed" onChange={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'history.filterSuccess' }),
    ).toBeInTheDocument()
  })

  it('reports the picked status through onChange', async () => {
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <HistoryFilters value="all" onChange={onChange} />,
    )

    await user.click(screen.getByRole('button', { name: 'history.filterAll' }))
    await user.click(
      screen.getByRole('menuitem', { name: 'history.filterFailed' }),
    )

    expect(onChange).toHaveBeenCalledWith('failed')
  })
})
