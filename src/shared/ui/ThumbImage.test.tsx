/**
 * ThumbImage suite. Shared thumbnail with unified fallback: falsy src and
 * load errors render the same muted ImageOff placeholder, a changed src
 * retries immediately, and showIcon={false} drops the icon for tiny frames.
 */

import { renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThumbImage } from './ThumbImage'

/** Placeholder branch: no img, but a span with the bg-muted placeholder look. */
function expectPlaceholder(container: HTMLElement) {
  expect(screen.queryByRole('img')).toBeNull()
  expect(container.querySelector('span.bg-muted')).toBeInTheDocument()
}

describe('ThumbImage', () => {
  it('renders the img with src and passes through img attributes', () => {
    renderWithProviders(
      <ThumbImage
        src="https://img.example/t.jpg"
        alt="A title"
        loading="lazy"
        className="size-full object-cover"
      />,
    )

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img).toHaveAttribute('src', 'https://img.example/t.jpg')
    expect(img).toHaveAttribute('alt', 'A title')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveClass('size-full', 'object-cover')
  })

  it('renders the placeholder for undefined, empty and null src', () => {
    const { container, rerender } = renderWithProviders(
      <ThumbImage src={undefined} />,
    )
    expectPlaceholder(container)

    rerender(<ThumbImage src="" />)
    expectPlaceholder(container)

    rerender(<ThumbImage src={null} />)
    expectPlaceholder(container)
  })

  it('switches to the placeholder on load error', () => {
    const { container } = renderWithProviders(
      <ThumbImage src="https://img.example/403.jpg" />,
    )

    fireEvent.error(screen.getByRole('img'))
    expectPlaceholder(container)
  })

  it('retries when src changes after a failure', () => {
    const { container, rerender } = renderWithProviders(
      <ThumbImage src="https://img.example/bad.jpg" />,
    )
    fireEvent.error(screen.getByRole('img'))

    rerender(<ThumbImage src="https://img.example/good.jpg" />)
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://img.example/good.jpg',
    )

    // Failing again with the new URL re-enters the placeholder.
    fireEvent.error(screen.getByRole('img'))
    expectPlaceholder(container)
  })

  it('omits the ImageOff icon when showIcon is false', () => {
    const { container } = renderWithProviders(
      <ThumbImage src={undefined} showIcon={false} />,
    )

    expectPlaceholder(container)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('keeps the icon in the placeholder by default', () => {
    const { container } = renderWithProviders(<ThumbImage src={undefined} />)

    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  // Regression: call sites pass display:'block' for the img baseline gap,
  // but the placeholder must keep its centering flex (twMerge resolves
  // the display conflict — the component's class order decides the winner).
  it('keeps flex centering when the caller className contains block', () => {
    const { container } = renderWithProviders(
      <ThumbImage src={undefined} className="block aspect-video w-full" />,
    )

    const placeholder = container.querySelector('span.bg-muted')
    expect(placeholder).toHaveClass('flex', 'items-center', 'justify-center')
    expect(placeholder).not.toHaveClass('block')
  })
})
