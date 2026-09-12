/**
 * SettingToggleGroup suite: segment wiring, tooltip variant and the
 * no-op guard for re-clicking the active segment.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SettingToggleGroup } from './SettingToggleGroup'

const options = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B', tooltip: 'tip-b' },
]

describe('SettingToggleGroup', () => {
  it('renders one segment per option and marks the active one', () => {
    renderWithProviders(
      <SettingToggleGroup
        value="a"
        onValueChange={vi.fn()}
        options={options}
      />,
    )

    expect(
      screen
        .getByText('Option A')
        .closest('button')!
        .getAttribute('data-state'),
    ).toBe('on')
    expect(
      screen
        .getByText('Option B')
        .closest('button')!
        .getAttribute('data-state'),
    ).toBe('off')
  })

  it('renders the tooltip button only for options carrying a tooltip', () => {
    renderWithProviders(
      <SettingToggleGroup
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
      <SettingToggleGroup
        value="a"
        onValueChange={onValueChange}
        options={options}
      />,
    )

    await user.click(screen.getByText('Option B').closest('button')!)

    expect(onValueChange).toHaveBeenCalledWith('b')
  })

  it('swallows the empty value emitted by re-clicking the active segment', async () => {
    const onValueChange = vi.fn()
    const { user } = renderWithProviders(
      <SettingToggleGroup
        value="a"
        onValueChange={onValueChange}
        options={options}
      />,
    )

    await user.click(screen.getByText('Option A').closest('button')!)

    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('info tooltip buttons swallow their click via preventDefault', async () => {
    const { user } = renderWithProviders(
      <SettingToggleGroup
        value="a"
        onValueChange={vi.fn()}
        options={options}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'tip-b' }))

    expect(screen.getByText('Option B')).toBeInTheDocument()
  })
})
