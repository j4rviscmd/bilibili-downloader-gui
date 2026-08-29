import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import CircleIndicator from './CircleIndicator'

// Loader2 renders a plain svg with no role, so locate it structurally.
function getLoader(container: HTMLElement): Element {
  const svg = container.querySelector('svg')
  expect(svg).not.toBeNull()
  return svg!
}

describe('CircleIndicator', () => {
  it('renders a spinning loader at the default lg size', () => {
    const { container } = render(<CircleIndicator />)

    expect(getLoader(container)).toHaveClass('animate-spin', 'h-8', 'w-8')
  })

  it('applies the class for each size variant', () => {
    const { container, rerender } = render(<CircleIndicator size="sm" />)

    const icon = getLoader(container)
    expect(icon).toHaveClass('h-4', 'w-4')

    rerender(<CircleIndicator size="md" />)
    expect(icon).toHaveClass('h-6', 'w-6')
  })

  it('merges a custom className', () => {
    const { container } = render(<CircleIndicator className="mt-2" />)

    expect(getLoader(container)).toHaveClass('mt-2')
  })
})
