/**
 * Fly-to-bar thumbnail animation bus (issue #691 comment 3).
 *
 * The download button publishes the origin rect (and the first selected
 * part's thumbnail); the always-mounted ThumbnailFlightLayer subscribes
 * and animates a fixed-position clone toward the bottom bar's avatar
 * area. A tiny pub/sub keeps the trigger site (features/video) decoupled
 * from the animation owner (shared/queue/ui) without threading DOM
 * knowledge through Redux.
 */

/** One in-flight thumbnail clone. */
export type ThumbnailFlight = {
  /** Sequence id for list keys and completion removal. */
  id: number
  /** Thumbnail image URL (null renders a plain placeholder tile). */
  url: string | null
  /** Origin viewport rect (the clicked download button). */
  from: { x: number; y: number; width: number; height: number }
}

type Listener = (flight: ThumbnailFlight) => void

const listeners = new Set<Listener>()
let seq = 0

/** Publishes a flight from the given button rect toward the bottom bar. */
export function startThumbnailFlight(origin: {
  url: string | null
  rect: { x: number; y: number; width: number; height: number }
}): void {
  const flight: ThumbnailFlight = {
    id: ++seq,
    url: origin.url,
    from: origin.rect,
  }
  listeners.forEach((l) => l(flight))
}

/** Subscribes to published flights; returns the unsubscribe function. */
export function subscribeThumbnailFlights(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only: resets the listener set and the sequence counter. */
export function __resetThumbnailFlightsForTest(): void {
  listeners.clear()
  seq = 0
}
