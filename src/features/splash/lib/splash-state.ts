/**
 * @module splash-state
 * Promise-based coordination primitives for the splash screen lifecycle.
 *
 * Each promise acts as a one-shot signal: the splash module awaits it while
 * the rest of the application resolves it at the appropriate moment.
 */

let resolveInitComplete: (() => void) | null = null
let resolveFading: (() => void) | null = null
let resolveDone: (() => void) | null = null

/**
 * Resolved by the backend (via {@link notifyInitComplete}) once all startup
 * tasks have finished.
 */
export const initCompletePromise = new Promise<void>((resolve) => {
  resolveInitComplete = resolve
})

/** Resolved when the splash screen begins its fade-out transition. */
export const splashFadingPromise = new Promise<void>((resolve) => {
  resolveFading = resolve
})

/** Resolved when the splash screen has been fully removed from the DOM. */
export const splashDonePromise = new Promise<void>((resolve) => {
  resolveDone = resolve
})

/**
 * Signals that backend initialization has completed.
 * Resolves {@link initCompletePromise}.
 */
export function notifyInitComplete() {
  resolveInitComplete?.()
}

/**
 * Signals that the splash screen has started fading out.
 * Resolves {@link splashFadingPromise}.
 */
export function notifySplashFading() {
  resolveFading?.()
}

/**
 * Signals that the splash screen has been fully removed.
 * Resolves {@link splashDonePromise}.
 */
export function notifySplashDone() {
  resolveDone?.()
}
