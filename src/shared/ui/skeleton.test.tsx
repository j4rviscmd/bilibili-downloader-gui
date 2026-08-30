/**
 * Skeleton suite. Renders the data-slot hook plus the pulse animation and
 * merges the caller's className.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Skeleton } from './skeleton'

describe('Skeleton', () => {
  it('renders with the skeleton data-slot and animate-pulse', () => {
    renderWithProviders(<Skeleton data-testid="sk" />)

    const el = screen.getByTestId('sk')
    expect(el).toHaveAttribute('data-slot', 'skeleton')
    expect(el.className).toContain('animate-pulse')
  })

  it('appends the caller className to the base classes', () => {
    renderWithProviders(<Skeleton className="h-4 w-full" data-testid="sk" />)

    const el = screen.getByTestId('sk')
    expect(el.className).toContain('h-4')
    expect(el.className).toContain('w-full')
    expect(el.className).toContain('rounded-md')
  })
})
