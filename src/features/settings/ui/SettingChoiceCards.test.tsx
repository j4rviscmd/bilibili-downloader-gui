/**
 * SettingChoiceCards suite: card wiring, hint/tooltip variants and the
 * aria-pressed selected state.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SettingChoiceCards } from './SettingChoiceCards'

const options = [
  { value: 'a', label: 'Card A' },
  { value: 'b', label: 'Card B', tooltip: 'tip-b', hint: 'hint-b' },
]

describe('SettingChoiceCards', () => {
  it('renders one card per option and marks the selected one', () => {
    renderWithProviders(
      <SettingChoiceCards
        value="a"
        onValueChange={vi.fn()}
        options={options}
      />,
    )

    expect(
      screen.getByText('Card A').closest('button[aria-pressed]')!,
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByText('Card B').closest('button[aria-pressed]')!,
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('hint-b')).toBeInTheDocument()
  })

  it('renders the tooltip button only for options carrying a tooltip', () => {
    renderWithProviders(
      <SettingChoiceCards
        value="a"
        onValueChange={vi.fn()}
        options={options}
      />,
    )

    expect(screen.getByRole('button', { name: 'tip-b' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'tip-a' })).toBeNull()
  })

  it('reports the picked option value', async () => {
    const onValueChange = vi.fn()
    const { user } = renderWithProviders(
      <SettingChoiceCards
        value="a"
        onValueChange={onValueChange}
        options={options}
      />,
    )

    await user.click(
      screen.getByText('Card B').closest('button[aria-pressed]')!,
    )

    expect(onValueChange).toHaveBeenCalledWith('b')
  })

  it('info tooltip buttons swallow their click via preventDefault', async () => {
    const { user } = renderWithProviders(
      <SettingChoiceCards
        value="a"
        onValueChange={vi.fn()}
        options={options}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'tip-b' }))

    expect(
      screen.getByText('Card A').closest('button[aria-pressed]')!,
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
