/**
 * PageTemplate suite.
 *
 * Pure presentational frame: assert both header layouts and that
 * children land in the body wrapper.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageTemplate } from './PageTemplate'

describe('PageTemplate', () => {
  it('renders a simple header with title and description', () => {
    renderWithProviders(
      <PageTemplate title="Page Title" description="Page description">
        <div>body-content</div>
      </PageTemplate>,
    )

    expect(
      screen.getByRole('heading', { name: 'Page Title' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Page description')).toBeInTheDocument()
    expect(screen.getByText('body-content')).toBeInTheDocument()
  })

  it('omits the description node when not provided', () => {
    renderWithProviders(
      <PageTemplate title="Page Title">
        <div>body-content</div>
      </PageTemplate>,
    )

    expect(screen.queryByText('Page description')).toBeNull()
  })

  it('renders the toolbar layout when actions are provided', () => {
    renderWithProviders(
      <PageTemplate
        title="Page Title"
        actions={<button type="button">action-button</button>}
      >
        <div>body-content</div>
      </PageTemplate>,
    )

    expect(screen.getByText('action-button')).toBeInTheDocument()
    expect(screen.getByText('body-content')).toBeInTheDocument()
  })

  it('keeps the default body wrapper non-scrolling (internal mode)', () => {
    const { container } = renderWithProviders(
      <PageTemplate title="Page Title">
        <div>body-content</div>
      </PageTemplate>,
    )

    expect(container.querySelector('.overflow-y-auto')).toBeNull()
  })

  it('renders a full-width scroll container wrapping the centered rail in bodyScroll mode', () => {
    const { container } = renderWithProviders(
      <PageTemplate title="Page Title" bodyScroll>
        <div>body-content</div>
      </PageTemplate>,
    )

    // The scroll container spans the full width; the centered rail (and
    // the body content) live inside it, so the scrollbar rides the
    // window edge and the margins beside the rail also scroll.
    const scroller = container.querySelector<HTMLDivElement>('.overflow-y-auto')
    expect(scroller).not.toBeNull()
    const rail = scroller!.querySelector('.max-w-\\[104rem\\]')
    expect(rail).not.toBeNull()
    expect(rail!.textContent).toContain('body-content')
  })

  it('hands the scroll container element to scrollRef in bodyScroll mode', () => {
    const received: HTMLDivElement[] = []
    renderWithProviders(
      <PageTemplate
        title="Page Title"
        bodyScroll
        scrollRef={(el) => {
          if (el) received.push(el)
        }}
      >
        <div>body-content</div>
      </PageTemplate>,
    )

    // Consumers (Virtuoso customScrollParent, useFeedSentinel) observe
    // the element that actually owns the scrolling.
    expect(received[0]?.className).toContain('overflow-y-auto')
  })

  it('keeps the header outside the scroll container in bodyScroll mode', () => {
    renderWithProviders(
      <PageTemplate
        title="Page Title"
        bodyScroll
        actions={<button type="button">action-button</button>}
      >
        <div>body-content</div>
      </PageTemplate>,
    )

    // The header strip stays pinned above the scroller: title and
    // actions remain visible while the body scrolls.
    const scroller = document.querySelector('.overflow-y-auto')
    expect(scroller).not.toBeNull()
    expect(scroller!.textContent).not.toContain('Page Title')
    expect(scroller!.textContent).not.toContain('action-button')
  })
})
