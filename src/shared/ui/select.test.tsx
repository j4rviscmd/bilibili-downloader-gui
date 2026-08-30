/**
 * Select suite. Covers open/choose through Radix (happy-dom pointer stub,
 * same pattern as WatchHistoryFilters), placeholder, size variants, and the
 * group/label/separator structure inside the content.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select'

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

function renderSelect(props: {
  value?: string
  onValueChange?: (v: string) => void
  placeholder?: string
  size?: 'sm' | 'default'
}) {
  return renderWithProviders(
    <Select value={props.value} onValueChange={props.onValueChange}>
      <SelectTrigger size={props.size} aria-label="pick">
        <SelectValue placeholder={props.placeholder ?? 'Pick one'} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Group label</SelectLabel>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
          <SelectSeparator />
          <SelectItem value="c" disabled>
            Option C
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>,
  )
}

describe('Select', () => {
  it('shows the placeholder when no value is selected', () => {
    renderSelect({ placeholder: 'Pick a fruit' })

    expect(screen.getByRole('combobox', { name: 'pick' })).toHaveTextContent(
      'Pick a fruit',
    )
  })

  it('renders the selected item text in the trigger', () => {
    renderSelect({ value: 'a' })

    expect(screen.getByRole('combobox', { name: 'pick' })).toHaveTextContent(
      'Option A',
    )
  })

  it('applies the sm size data attribute to the trigger', () => {
    renderSelect({ size: 'sm' })

    expect(screen.getByRole('combobox')).toHaveAttribute('data-size', 'sm')
  })

  it('opens the content, lists options and reports the picked value', async () => {
    const onValueChange = vi.fn()
    const { user } = renderSelect({ onValueChange })

    await user.click(screen.getByRole('combobox', { name: 'pick' }))

    // Content renders in a portal: group label and all options are visible.
    expect(screen.getByText('Group label')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Option A' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Option B' })).toBeInTheDocument()
    // Radix marks disabled options with aria-disabled.
    expect(screen.getByRole('option', { name: 'Option C' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await user.click(screen.getByRole('option', { name: 'Option B' }))

    expect(onValueChange).toHaveBeenCalledWith('b')
  })

  it('marks the selected option as checked when reopened', async () => {
    const { user } = renderSelect({ value: 'a' })

    await user.click(screen.getByRole('combobox', { name: 'pick' }))

    // Radix flags the selected item with data-state=checked, which drives
    // the ItemIndicator (check icon) inside SelectItem.
    expect(screen.getByRole('option', { name: 'Option A' })).toHaveAttribute(
      'data-state',
      'checked',
    )
    expect(screen.getByRole('option', { name: 'Option B' })).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })
})
