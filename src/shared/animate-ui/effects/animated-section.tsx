import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Height-collapsing section (AnimatePresence + height 0↔auto) shared by the
 * inline download UI surfaces (card full↔compact swap, compact expander,
 * status bar).
 *
 * Uses a critically-damped spring (bounce 0 = no overshoot, response 0.35s —
 * apple-design defaults for non-momentum motion) so every collapse/expand
 * reads as one continuous, interruptible motion; springs start from the
 * current on-screen value, so rapid toggles never jump. Reduced motion
 * collapses to an instant swap.
 */
export function AnimatedSection({
  show,
  children,
}: {
  show: boolean
  children: ReactNode
}) {
  const reduceMotion = useReducedMotion()
  const transition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, bounce: 0, duration: 0.35 }

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={transition}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
