/**
 * ThumbImage suite. Shared thumbnail with unified fallback: falsy src and
 * load errors render the same muted ImageOff placeholder, a changed src
 * retries immediately, and showIcon={false} drops the icon for tiny frames.
 */

import { renderWithProviders } from '@/test/test-utils'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThumbImage } from './ThumbImage'

/** Placeholder branch: no img, but a span with the bg-muted placeholder look. */
function expectPlaceholder(container: HTMLElement) {
  expect(screen.queryByRole('img')).toBeNull()
  expect(container.querySelector('span.bg-muted')).toBeInTheDocument()
}

function deferDecode(): () => void {
  // Manual deferred: tsconfig lib < es2024 has no Promise.withResolvers.
  let resolveDecode!: () => void
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockReturnValue(
    new Promise<void>((resolve) => {
      resolveDecode = resolve
    }),
  )
  return resolveDecode
}

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('pulses as a skeleton until the image is decoded', async () => {
    renderWithProviders(<ThumbImage src="https://img.example/t.jpg" />)
    const img = screen.getByRole('img')
    expect(img).toHaveClass('animate-pulse', 'bg-brand/10')

    await act(async () => {
      fireEvent.load(img)
    })
    expect(screen.getByRole('img')).toBe(img)
    expect(img).not.toHaveClass('animate-pulse')
    expect(img).not.toHaveClass('bg-brand/10')
  })

  it('keeps the image content parked until decode resolves', async () => {
    const resolveDecode = deferDecode()
    renderWithProviders(<ThumbImage src="https://img.example/slow.jpg" />)
    const img = screen.getByRole('img')
    const parked = '[object-position:-10000px_0]'
    expect(img).toHaveClass(parked)

    await act(async () => {
      fireEvent.load(img)
    })
    expect(img).toHaveClass('animate-pulse', parked)

    await act(async () => {
      resolveDecode()
    })
    expect(img).not.toHaveClass('animate-pulse')
    expect(img).not.toHaveClass(parked)
  })

  it('shows the skeleton again when src changes after a decode', async () => {
    const { rerender } = renderWithProviders(
      <ThumbImage src="https://img.example/a.jpg" />,
    )
    const img = screen.getByRole('img')
    await act(async () => {
      fireEvent.load(img)
    })
    expect(img).not.toHaveClass('animate-pulse')

    rerender(<ThumbImage src="https://img.example/b.jpg" />)
    expect(screen.getByRole('img')).toHaveClass('animate-pulse', 'bg-brand/10')
  })

  it('reveals on a rejected decode: onError owns failure', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(
      new Error('undecodable'),
    )
    renderWithProviders(<ThumbImage src="https://img.example/bad.jpg" />)
    const img = screen.getByRole('img')

    await act(async () => {
      fireEvent.load(img)
    })
    expect(img).not.toHaveClass('animate-pulse')
  })

  it('ignores a decode that settles after src changed', async () => {
    const resolveDecode = deferDecode()
    const { rerender } = renderWithProviders(
      <ThumbImage src="https://img.example/a.jpg" />,
    )
    const img = screen.getByRole('img')
    await act(async () => {
      fireEvent.load(img)
    })

    rerender(<ThumbImage src="https://img.example/b.jpg" />)
    await act(async () => {
      resolveDecode()
    })
    expect(screen.getByRole('img')).toHaveClass('animate-pulse', 'bg-brand/10')
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

  it('keeps caller className after load and on the placeholder', async () => {
    const className = 'h-9 w-16 shrink-0 rounded-md object-cover'
    const { container, rerender } = renderWithProviders(
      <ThumbImage src="https://img.example/t.jpg" className={className} />,
    )

    const img = screen.getByRole('img')
    await act(async () => {
      fireEvent.load(img)
    })
    expect(img).toHaveClass('h-9', 'w-16', 'shrink-0', 'rounded-md')

    rerender(<ThumbImage src={null} className={className} />)
    expect(container.querySelector('span.bg-muted')).toHaveClass(
      'h-9',
      'w-16',
      'shrink-0',
      'rounded-md',
    )
  })

  it('reveals the new src on its own load after a stale decode', async () => {
    const resolveDecode = deferDecode()
    const { rerender } = renderWithProviders(
      <ThumbImage src="https://img.example/a.jpg" />,
    )
    const img = screen.getByRole('img')
    await act(async () => {
      fireEvent.load(img)
    })
    rerender(<ThumbImage src="https://img.example/b.jpg" />)
    await act(async () => {
      resolveDecode()
    })
    // Ignoring the stale settlement must not latch: the new src's own load
    // still has to reveal, or the thumbnail pulses forever.
    await act(async () => {
      fireEvent.load(screen.getByRole('img'))
    })
    expect(screen.getByRole('img')).not.toHaveClass('animate-pulse')
  })
})
