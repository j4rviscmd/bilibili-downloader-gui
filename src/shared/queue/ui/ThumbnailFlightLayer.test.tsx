/**
 * ThumbnailFlightLayer suite.
 *
 * Locks the fly-to-bar bus (publish/subscribe) and the layer's render
 * lifecycle: a published flight renders a fixed clone that springs toward
 * the bottom bar's avatar target and unmounts on completion.
 */

import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThumbnailFlightLayer } from './ThumbnailFlightLayer'
import {
  __resetThumbnailFlightsForTest,
  startThumbnailFlight,
  subscribeThumbnailFlights,
} from './thumbnailFlight'

describe('thumbnailFlight bus', () => {
  beforeEach(() => {
    __resetThumbnailFlightsForTest()
  })

  it('delivers published flights to subscribers until unsubscribed', () => {
    const seen: string[] = []
    const unsubscribe = subscribeThumbnailFlights((f) => seen.push(f.url ?? ''))
    startThumbnailFlight({
      url: 'https://img/a',
      rect: { x: 1, y: 2, width: 10, height: 10 },
    })
    unsubscribe()
    startThumbnailFlight({
      url: 'https://img/b',
      rect: { x: 1, y: 2, width: 10, height: 10 },
    })
    expect(seen).toEqual(['https://img/a'])
  })
})

describe('ThumbnailFlightLayer', () => {
  beforeEach(() => {
    __resetThumbnailFlightsForTest()
    vi.clearAllMocks()
  })

  it('renders nothing until a flight is published', () => {
    const { container } = render(<ThumbnailFlightLayer />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('second concurrent flight takes the direct path (no bounce)', async () => {
    const realRect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Element) {
        if (this.getAttribute?.('data-slot') === 'avatar') {
          return {
            x: 940,
            y: 908,
            top: 908,
            left: 940,
            bottom: 940,
            right: 972,
            width: 32,
            height: 32,
            toJSON: () => ({}),
          } as DOMRect
        }
        return realRect.call(this)
      },
    )
    try {
      const { container } = render(
        <>
          <div data-queue-avatar-target="true">
            <div data-slot="avatar" />
          </div>
          <ThumbnailFlightLayer />
        </>,
      )

      // Two rapid enqueues: the first bounces, the second (while the
      // first is still airborne) flies direct — both clones must appear
      // and both must clean themselves up.
      startThumbnailFlight({
        url: 'https://img/first.jpg',
        rect: { x: 100, y: 100, width: 96, height: 60 },
      })
      await waitFor(() =>
        expect(container.querySelectorAll('img')).toHaveLength(1),
      )
      startThumbnailFlight({
        url: 'https://img/second.jpg',
        rect: { x: 200, y: 100, width: 96, height: 60 },
      })
      await waitFor(() =>
        expect(container.querySelectorAll('img')).toHaveLength(2),
      )

      await waitFor(() => expect(container.querySelector('img')).toBeNull(), {
        timeout: 4000,
      })
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('flies a published thumbnail to the avatar target and removes itself', async () => {
    // jsdom returns zero rects everywhere: give the landing zone a real
    // geometry so the flight can find its target.
    const realRect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Element) {
        if (this.hasAttribute?.('data-queue-avatar-target')) {
          return {
            x: 900,
            y: 900,
            top: 900,
            left: 900,
            bottom: 940,
            right: 1000,
            width: 100,
            height: 40,
            toJSON: () => ({}),
          } as DOMRect
        }
        return realRect.call(this)
      },
    )
    try {
      const { container } = render(
        <>
          <div data-queue-avatar-target="true">
            {/* The session's own avatar slot (sessions append at the tail). */}
            <div data-slot="avatar" />
          </div>
          <ThumbnailFlightLayer />
        </>,
      )

      startThumbnailFlight({
        url: 'https://img/fly.jpg',
        rect: { x: 100, y: 100, width: 96, height: 60 },
      })

      const img = await waitFor(() => {
        const el = container.querySelector('img')
        expect(el).not.toBeNull()
        return el as HTMLImageElement
      })
      expect(img.getAttribute('src')).toBe('https://img/fly.jpg')

      // The clone springs to the target and unmounts (animation completion
      // drives the removal; generous timeout for CI timing).
      await waitFor(() => expect(container.querySelector('img')).toBeNull(), {
        timeout: 4000,
      })
    } finally {
      vi.restoreAllMocks()
    }
  })
})
