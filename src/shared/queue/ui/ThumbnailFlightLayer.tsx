import { motion, useReducedMotion, type Easing } from 'motion/react'
import { useEffect, useRef, useState, type FC } from 'react'

import {
  subscribeThumbnailFlights,
  type ThumbnailFlight,
} from './thumbnailFlight'

/**
 * Delay before the first landing-point measurement (ms). The flight is
 * published BEFORE the enqueue dispatch (the button launches it first),
 * so measuring immediately latches onto the PREVIOUS session's last slot
 * — the new avatar then pops in to its right and the clone reads as
 * landing left of it. This waits out the store commit + React render.
 */
const MEASURE_DELAY_MS = 150

/**
 * How long to wait for the bottom bar's avatar target to appear AND
 * stabilize (ms, counted after the delay above). On the FIRST enqueue the
 * bar itself is still springing in (height 0 → full), during which the
 * avatar slots sit near the very bottom of the viewport — measuring then
 * made the flight overshoot below the settled slot position.
 */
const TARGET_WAIT_MS = 1000

/**
 * Fall time to the contact point (s) — the only free timing parameter:
 * rebound height and every segment duration are derived from it via the
 * restitution coefficient, so the bounce reads consistently at any
 * window size.
 */
const FALL_S = 0.34

/** Restitution coefficient e (0..1): rebound height = e² × fall height,
 * rise time = e × fall time (visual sweet spot 0.5-0.65). */
const RESTITUTION = 0.6

/** Fraction of the vertical drop where the mid-screen contact happens. */
const CONTACT_AT = 0.55

/** Post-landing squash restore + fade window (ms). */
const RESTORE_MS = 120

/** Converts rem to px against the app's live root font size — the whole
 * UI scales with the user's font-size setting, so fixed-px offsets would
 * drift out of proportion at larger/smaller sizes. */
function remToPx(rem: number): number {
  return (
    rem *
    parseFloat(getComputedStyle(document.documentElement).fontSize || '16')
  )
}

/**
 * Landing is lifted this far ABOVE the slot center (0.5rem = 8px at the
 * default root): with the clone's squash and the bar sitting flush at the
 * viewport bottom, an exact-center landing still reads as dipping past the
 * avatar, so the resting point is biased slightly upward.
 */
const LANDING_LIFT_REM = 0.5

/**
 * The avatar slots overlap by -space-x-3 with earlier slots on top, so the
 * LAST slot's center sits on the visual boundary between avatars and an
 * exact-center landing reads as left of the avatar's visible sliver.
 * Biasing right (1.5rem = 24px at the default root) recenters the clone
 * on what the user sees.
 */
const LANDING_RIGHT_BIAS_REM = 1.5

/** Direct-flight duration (s) for concurrent clones (no bounce path). */
const DIRECT_S = 0.45

/**
 * Hard removal deadline (ms). The single keyframed animation's completion
 * is the normal exit, but it can be missed (e.g. hidden tab suspends
 * rAF) — a lingering fixed clone would block nothing but still look
 * wrong, so this backstop guarantees the clone disappears.
 */
// Covers worst case: full TARGET_WAIT stabilization + the ~0.9s flight.
const FLIGHT_DEADLINE_MS = 2600

/**
 * Renders the in-flight thumbnail clones (issue #691 comment 3): each one
 * follows a physically-coherent ballistic arc from the clicked download
 * button — accelerating fall, a basketball rebound mid-screen (height ∝
 * e² of the fall), a second fall — then squashes onto the avatar slot and
 * dissolves. Mounted permanently next to QueueBottomBar in
 * PageLayoutShell so flights work from any page.
 *
 * Rapid-fire enqueues: only the FIRST concurrently-airborne clone
 * bounces; the rest fly direct (short arc, no bounce) so simultaneous
 * flights don't turn into visual chaos.
 *
 * Skipped entirely under prefers-reduced-motion.
 */
export const ThumbnailFlightLayer: FC = () => {
  const reduceMotion = useReducedMotion()
  const [flights, setFlights] = useState<
    (ThumbnailFlight & { bounce: boolean })[]
  >([])

  useEffect(() => {
    if (reduceMotion) return
    return subscribeThumbnailFlights((flight) => {
      setFlights((prev) => [...prev, { ...flight, bounce: prev.length === 0 }])
    })
  }, [reduceMotion])

  if (flights.length === 0) return null

  return (
    <>
      {flights.map((flight) => (
        <FlyingThumbnail
          key={flight.id}
          flight={flight}
          bounce={flight.bounce}
          onDone={() =>
            setFlights((prev) => prev.filter((f) => f.id !== flight.id))
          }
        />
      ))}
    </>
  )
}

type FlyingProps = {
  flight: ThumbnailFlight
  /** Full basketball bounce (first airborne clone) vs direct flight. */
  bounce: boolean
  onDone: () => void
}

/**
 * Resolves the landing point: the LAST avatar slot inside the bar's avatar
 * group — the slot the freshly enqueued session's own avatar occupies
 * (sessions append at the group's tail). Falls back to the group wrapper
 * when no slot is measurable yet (first enqueue / remainder-only).
 */
/** Landing point plus the slot's live size (px) for scale targeting. */
type LandingPoint = { x: number; y: number; width: number }

function findLandingPoint(): LandingPoint | null {
  const slots = document.querySelectorAll(
    '[data-queue-avatar-target] [data-slot="avatar"]',
  )
  for (let i = slots.length - 1; i >= 0; i--) {
    const rect = slots[i].getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
      }
    }
  }
  const wrapper = document
    .querySelector('[data-queue-avatar-target]')
    ?.getBoundingClientRect()
  if (wrapper && wrapper.width > 0 && wrapper.height > 0) {
    return {
      x: wrapper.left + wrapper.width / 2,
      y: wrapper.top + wrapper.height / 2,
      width: Math.min(wrapper.width, wrapper.height),
    }
  }
  return null
}

/** One clone: waits for the landing point, flies the arc, reports done. */
const FlyingThumbnail: FC<FlyingProps> = ({ flight, bounce, onDone }) => {
  const [target, setTarget] = useState<LandingPoint | null>(null)
  const doneRef = useRef(false)
  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }

  useEffect(() => {
    // Removal backstop — see FLIGHT_DEADLINE_MS.
    const deadline = setTimeout(finish, FLIGHT_DEADLINE_MS)
    let raf = 0
    const startedAt = performance.now()
    // The bar may still be springing in (first enqueue) or the clone may
    // outlive the bar (queue drained mid-flight) — poll a few frames for a
    // measurable landing point, then give up silently.
    // Stability gate: the bar's spring-in moves the slots for ~350ms, so
    // a point is only accepted after it repeats within 1px on consecutive
    // frames. On timeout the last seen point is used as a best effort.
    let lastPoint: LandingPoint | null = null
    const tryFindTarget = () => {
      const point = findLandingPoint()
      const stable =
        point &&
        lastPoint &&
        Math.abs(point.x - lastPoint.x) < 1 &&
        Math.abs(point.y - lastPoint.y) < 1
      if (stable && point) {
        setTarget(point)
        return
      }
      lastPoint = point
      if (performance.now() - startedAt < TARGET_WAIT_MS) {
        raf = requestAnimationFrame(tryFindTarget)
      } else if (point) {
        setTarget(point)
      } else {
        finish()
      }
    }
    // Start measuring only after the enqueue has committed (see
    // MEASURE_DELAY_MS) — earliest frames show the stale slot layout.
    raf = requestAnimationFrame(() =>
      setTimeout(tryFindTarget, MEASURE_DELAY_MS),
    )
    return () => {
      clearTimeout(deadline)
      cancelAnimationFrame(raf)
    }
  }, [])

  if (!target) return null

  const { from } = flight
  const fromCx = from.x + from.width / 2
  const fromCy = from.y + from.height / 2
  // Per-axis landing scales: the clone becomes the slot's live size (the
  // avatar is rem-sized and scales with the user's font setting).
  const finalScaleX = target.width / Math.max(from.width, 1)
  const finalScaleY = target.width / Math.max(from.height, 1)
  // Straight descent (no upward arc — a rising detour read as leaving the
  // screen). Bounded so the clone can never leave the viewport even if the
  // measured rects are odd. Landing biases are rem-based so they track the
  // font-size scaling.
  const maxDeltaY = Math.max(0, window.innerHeight - from.y - from.height)
  const deltaY = Math.max(
    0,
    Math.min(target.y - fromCy, maxDeltaY) - remToPx(LANDING_LIFT_REM),
  )
  const dx = target.x - fromCx + remToPx(LANDING_RIGHT_BIAS_REM)

  // --- Physics-derived keyframes (one single animation — chained
  //     controls.start() calls resolve on the completion frame and stall
  //     the next stage for a frame, which read as a freeze at the contact
  //     point; keyframes keep the whole arc frame-continuous). ---
  const restoreS = RESTORE_MS / 1000
  const contactY = deltaY * CONTACT_AT
  const h1 = contactY
  // Rebound height ∝ e² (geometric decay of a real bounce), clamped to the
  // headroom above the contact point so the clone stays on screen.
  const h2 = bounce
    ? Math.min(RESTITUTION * RESTITUTION * h1, from.y + contactY)
    : 0
  const reboundY = contactY - h2
  // Rise time ∝ e (energy-scaled); second fall ∝ √h (Galileo).
  const tRise = RESTITUTION * FALL_S
  const tFall2 = h2 > 0 ? tRise * Math.sqrt((deltaY - reboundY) / h2) : 0
  const totalBounceS = FALL_S + tRise + tFall2 + restoreS

  const yKeys = bounce
    ? [0, contactY, reboundY, deltaY, deltaY]
    : [0, deltaY, deltaY]
  const times = bounce
    ? [
        0,
        FALL_S / totalBounceS,
        (FALL_S + tRise) / totalBounceS,
        (FALL_S + tRise + tFall2) / totalBounceS,
        1,
      ]
    : [0, (DIRECT_S - restoreS) / DIRECT_S, 1]
  // Gravity per segment: accelerate into the contact, decelerate to the
  // rebound peak, accelerate into the landing.
  const yEases: Easing[] = bounce
    ? ['easeIn', 'easeOut', 'easeIn', 'linear']
    : ['easeIn', 'linear']

  // Squash & stretch (volume-preserving, subtle): stretch along the fall,
  // squash on landing, restore in the trailing window. The shrink toward
  // the slot size is FRONT-LOADED (~3/4 by the rebound peak, near-final
  // during the second fall): a full-size clone centered on a slot at the
  // viewport-bottom bar spills below the bar during the approach, which
  // reads as overshooting past the avatar group.
  const scaleXKeys = bounce
    ? [1, 0.8, 0.72, finalScaleX * 1.12, finalScaleX]
    : [1, 0.75, finalScaleX]
  const scaleYKeys = bounce
    ? [1, 1.04, 0.74, finalScaleY * 0.86, finalScaleY]
    : [1, 0.75, finalScaleY]
  const opacityKeys = bounce ? [1, 1, 1, 1, 0] : [1, 1, 0]
  const duration = bounce ? totalBounceS : DIRECT_S

  return (
    <motion.div
      aria-hidden
      className="border-background bg-muted pointer-events-none fixed z-50 overflow-hidden rounded-lg border-2"
      style={{
        left: from.x,
        top: from.y,
        width: from.width,
        height: from.height,
      }}
      initial={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
      animate={{
        // x is linear on purpose: a projectile keeps constant horizontal
        // velocity — a spring here decelerates late and bends the arc.
        x: dx,
        y: yKeys,
        scaleX: scaleXKeys,
        scaleY: scaleYKeys,
        opacity: opacityKeys,
      }}
      transition={{
        x: { duration, ease: 'linear' },
        y: { duration, times, ease: yEases },
        scaleX: { duration, times, ease: 'linear' },
        scaleY: { duration, times, ease: 'linear' },
        opacity: { duration, times, ease: 'linear' },
      }}
      onAnimationComplete={finish}
    >
      {flight.url ? (
        <img
          src={flight.url}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : null}
    </motion.div>
  )
}
