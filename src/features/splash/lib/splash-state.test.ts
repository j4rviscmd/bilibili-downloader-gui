/**
 * splash-state suite.
 *
 * Each notify* function resolves its one-shot promise. The promises are
 * module singletons, so the resolution is asserted once here.
 */

import { describe, expect, it } from 'vitest'

import {
  initCompletePromise,
  notifyInitComplete,
  notifySplashDone,
  notifySplashFading,
  splashDonePromise,
  splashFadingPromise,
} from './splash-state'

describe('splash-state', () => {
  it('resolves each promise through its notify function', async () => {
    notifyInitComplete()
    notifySplashFading()
    notifySplashDone()

    // Promise.race against a never-settling timer: resolution must win.
    const never = new Promise<never>(() => {})
    await expect(
      Promise.race([
        Promise.all([
          initCompletePromise,
          splashFadingPromise,
          splashDonePromise,
        ]),
        never,
      ]),
    ).resolves.toBeDefined()
  })
})
