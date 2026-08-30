/**
 * Alert suite. Variant classes are selected through the cva variant map and
 * the title/description slots render with their data-slot hooks.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Alert, AlertDescription, AlertTitle } from './alert'

describe('Alert', () => {
  it.each([
    ['default', 'bg-card'],
    ['destructive', 'text-destructive'],
    ['warning', 'bg-amber-50'],
    ['info', 'bg-blue-50'],
  ] as const)(
    'applies the %s variant classes to the alert root',
    (variant, expectedClass) => {
      renderWithProviders(
        <Alert variant={variant} data-testid="alert">
          <AlertTitle>T</AlertTitle>
          <AlertDescription>D</AlertDescription>
        </Alert>,
      )

      const alert = screen.getByTestId('alert')
      expect(alert.className).toContain(expectedClass)
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert).toHaveAttribute('data-slot', 'alert')
    },
  )

  it('falls back to the default variant when none is given', () => {
    renderWithProviders(<Alert data-testid="alert" />)

    expect(screen.getByTestId('alert').className).toContain('bg-card')
    // The destructive-only class must not leak into the default variant.
    expect(screen.getByTestId('alert').className).not.toContain(
      'text-destructive bg-card',
    )
  })

  it('renders title and description with their data-slot hooks', () => {
    renderWithProviders(
      <Alert>
        <AlertTitle>Alert heading</AlertTitle>
        <AlertDescription>Alert body</AlertDescription>
      </Alert>,
    )

    expect(screen.getByText('Alert heading')).toHaveAttribute(
      'data-slot',
      'alert-title',
    )
    expect(screen.getByText('Alert body')).toHaveAttribute(
      'data-slot',
      'alert-description',
    )
  })

  it('merges the caller className on all three parts', () => {
    renderWithProviders(
      <Alert className="alert-custom" data-testid="alert">
        <AlertTitle className="title-custom">T</AlertTitle>
        <AlertDescription className="desc-custom">D</AlertDescription>
      </Alert>,
    )

    expect(screen.getByTestId('alert').className).toContain('alert-custom')
    expect(screen.getByText('T').className).toContain('title-custom')
    expect(screen.getByText('D').className).toContain('desc-custom')
  })
})
