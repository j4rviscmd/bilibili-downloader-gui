/**
 * Card suite. Structural smoke: every compound component renders its
 * data-slot and merges the caller's className.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'

describe('Card compound components', () => {
  it('renders every slot with its data-slot attribute', () => {
    renderWithProviders(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title text</CardTitle>
          <CardDescription>Description text</CardDescription>
          <CardAction>Action</CardAction>
        </CardHeader>
        <CardContent>Content text</CardContent>
        <CardFooter>Footer text</CardFooter>
      </Card>,
    )

    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-slot', 'card')

    // Each compound part is reachable through its data-slot hook.
    expect(
      screen.getByText('Title text').closest('[data-slot]'),
    ).toHaveAttribute('data-slot', 'card-title')
    expect(
      screen.getByText('Description text').closest('[data-slot]'),
    ).toHaveAttribute('data-slot', 'card-description')
    expect(screen.getByText('Action').closest('[data-slot]')).toHaveAttribute(
      'data-slot',
      'card-action',
    )
    expect(
      screen.getByText('Content text').closest('[data-slot]'),
    ).toHaveAttribute('data-slot', 'card-content')
    expect(
      screen.getByText('Footer text').closest('[data-slot]'),
    ).toHaveAttribute('data-slot', 'card-footer')
  })

  it('appends the caller className without dropping the base classes', () => {
    renderWithProviders(
      <Card className="my-custom" data-testid="card">
        <CardHeader className="header-custom">H</CardHeader>
        <CardContent className="content-custom">C</CardContent>
      </Card>,
    )

    const card = screen.getByTestId('card')
    expect(card.className).toContain('my-custom')
    expect(card.className).toContain('rounded-xl')

    expect(screen.getByText('H').className).toContain('header-custom')
    expect(screen.getByText('C').className).toContain('content-custom')
  })

  it('forwards extra div props to the Card shell', () => {
    renderWithProviders(
      <Card data-testid="card" id="shell" title="hover me">
        <CardContent>body</CardContent>
      </Card>,
    )

    expect(screen.getByTestId('card')).toHaveAttribute('id', 'shell')
    expect(screen.getByTestId('card')).toHaveAttribute('title', 'hover me')
  })
})
