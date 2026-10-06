/**
 * useFeedSentinel suite. happy-dom's IntersectionObserver never computes
 * intersections, so the stub records every constructed observer (root
 * included) and tests fire callbacks / inspect attachment by hand.
 */

import { renderWithProviders } from '@/test/test-utils'
import { act, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFeedSentinel } from './useFeedSentinel'

class StubObserver {
  static instances: StubObserver[] = []
  callback: (entries: { isIntersecting: boolean }[]) => void
  root: Element | Document | null | undefined
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(
    callback: StubObserver['callback'],
    options?: { root?: Element | Document | null },
  ) {
    this.callback = callback
    this.root = options?.root
    StubObserver.instances.push(this)
  }
}

// Module-level so its identity is stable across rerenders: the hook's
// effect deps include onReachEnd, and a changing identity would re-attach
// the observer for reasons the tests do not exercise.
const onReachEnd = vi.fn()

/** Minimal feed tail: scroll root + sentinel div wired to the hook. */
function Probe({
  disabled = false,
  recheckKey = 0,
  withRoot = true,
}: {
  disabled?: boolean
  recheckKey?: number
  /** False renders the sentinel without a scroll root (standalone list). */
  withRoot?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  useFeedSentinel({
    scrollRootRef: withRoot ? rootRef : undefined,
    sentinelRef,
    disabled,
    onReachEnd,
    recheckKey,
  })
  const sentinel = <div ref={sentinelRef} data-testid="sentinel" />
  return withRoot ? (
    <div data-testid="root" ref={rootRef}>
      {sentinel}
    </div>
  ) : (
    sentinel
  )
}

describe('useFeedSentinel', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', StubObserver)
  })
  afterEach(() => {
    vi.clearAllMocks()
    StubObserver.instances = []
    vi.unstubAllGlobals()
  })

  it('observes the sentinel rooted at the scroll container', () => {
    renderWithProviders(<Probe />)

    expect(StubObserver.instances).toHaveLength(1)
    // Scoped to the page's scroll container, not the browser viewport.
    expect(StubObserver.instances[0].root).toBe(screen.getByTestId('root'))
    expect(StubObserver.instances[0].observe).toHaveBeenCalledTimes(1)
    expect(StubObserver.instances[0].observe).toHaveBeenCalledWith(
      screen.getByTestId('sentinel'),
    )
  })

  it('fires onReachEnd only when the sentinel intersects', async () => {
    renderWithProviders(<Probe />)
    const observer = StubObserver.instances[0]

    await act(async () => {
      observer.callback([{ isIntersecting: false }])
    })
    expect(onReachEnd).not.toHaveBeenCalled()

    await act(async () => {
      observer.callback([{ isIntersecting: true }])
    })
    expect(onReachEnd).toHaveBeenCalledTimes(1)
  })

  it('attaches no observer while disabled and disconnects on re-disable', () => {
    // Disabled from the start: no observer at all.
    const { rerender } = renderWithProviders(<Probe disabled />)
    expect(StubObserver.instances).toHaveLength(0)

    rerender(<Probe disabled={false} />)
    expect(StubObserver.instances).toHaveLength(1)

    // Re-disabling must disconnect WITHOUT re-attaching — after a failed
    // page the sentinel often stays in view, and auto-retries would
    // hammer the backend in a tight loop (the error row owns recovery).
    rerender(<Probe disabled />)
    expect(StubObserver.instances).toHaveLength(1)
    expect(StubObserver.instances[0].disconnect).toHaveBeenCalledTimes(1)
  })

  it('re-attaches the observer when recheckKey changes (short-viewport append)', () => {
    // IntersectionObserver fires on CHANGES only — after an append on a
    // short viewport the still-intersecting sentinel needs a fresh
    // observation to keep loading.
    const { rerender } = renderWithProviders(<Probe recheckKey={0} />)
    const first = StubObserver.instances[0]

    rerender(<Probe recheckKey={1} />)
    expect(StubObserver.instances).toHaveLength(2)
    expect(first.disconnect).toHaveBeenCalledTimes(1)
    expect(StubObserver.instances[1].observe).toHaveBeenCalledTimes(1)
    expect(StubObserver.instances[1].observe).toHaveBeenCalledWith(
      screen.getByTestId('sentinel'),
    )
  })

  it('attaches no observer without a scroll root (standalone list render)', () => {
    renderWithProviders(<Probe withRoot={false} />)
    expect(StubObserver.instances).toHaveLength(0)
  })

  it('disconnects on unmount', () => {
    const { unmount } = renderWithProviders(<Probe />)
    unmount()
    expect(StubObserver.instances[0].disconnect).toHaveBeenCalledTimes(1)
  })
})
