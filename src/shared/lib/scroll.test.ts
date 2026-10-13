import { describe, expect, it, vi } from 'vitest'

import { scrollElementWithinScroller } from './scroll'

function build() {
  document.body.innerHTML = ''
  // Outer overflow-hidden shell — the app's sidebar wrapper equivalent:
  // programmatically scrollable but must never be touched.
  const outer = document.createElement('div')
  const scroller = document.createElement('div')
  scroller.className = 'overflow-y-auto'
  const target = document.createElement('div')
  outer.appendChild(scroller)
  scroller.appendChild(target)
  document.body.appendChild(outer)
  return { outer, scroller, target }
}

function stickyWithHeight(
  scroller: HTMLElement,
  height: number,
  style: Record<string, string>,
) {
  const el = document.createElement('div')
  el.className = 'sticky'
  Object.assign(el.style, style)
  Object.defineProperty(el, 'offsetHeight', { value: height })
  scroller.appendChild(el)
  return el
}

describe('scrollElementWithinScroller', () => {
  it('scrolls only the owning scroller, never outer overflow boxes', () => {
    const { outer, scroller, target } = build()
    const outerScrollTo = vi.spyOn(outer, 'scrollTo')
    const scrollTo = vi.spyOn(scroller, 'scrollTo')

    scrollElementWithinScroller(target, 20)

    // happy-dom lays out zero rects, so the computed top reduces to the
    // applied offsets: -(sticky cover 0) - (topOffset 20).
    expect(scrollTo).toHaveBeenCalledWith({ top: -20, behavior: 'smooth' })
    expect(outerScrollTo).not.toHaveBeenCalled()
  })

  it('subtracts the combined height of top-anchored stickies (multi-level stack)', () => {
    const { scroller, target } = build()
    // Two pinned levels, like the /search Step 1 area + Step 2 title row.
    stickyWithHeight(scroller, 89, { top: '0px' })
    stickyWithHeight(scroller, 60, { top: '89px' })
    const scrollTo = vi.spyOn(scroller, 'scrollTo')

    scrollElementWithinScroller(target, 8)

    expect(scrollTo).toHaveBeenCalledWith({ top: -157, behavior: 'smooth' })
  })

  it('ignores bottom-anchored stickies (the parts-list footer)', () => {
    const { scroller, target } = build()
    stickyWithHeight(scroller, 100, { top: '0px' })
    const footer = stickyWithHeight(scroller, 50, { bottom: '0px' })
    // The class marker is what the helper filters on (happy-dom reports
    // non-auto computed `top` for every element).
    footer.classList.add('bottom-0')
    const scrollTo = vi.spyOn(scroller, 'scrollTo')

    scrollElementWithinScroller(target, 20)

    expect(scrollTo).toHaveBeenCalledWith({ top: -120, behavior: 'smooth' })
  })

  it('is a no-op without a scrollable ancestor', () => {
    document.body.innerHTML = ''
    const target = document.createElement('div')
    document.body.appendChild(target)

    expect(() => scrollElementWithinScroller(target, 20)).not.toThrow()
  })
})
