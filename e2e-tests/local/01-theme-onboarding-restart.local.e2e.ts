/**
 * LOCAL-REAL E2E: the theme onboarding stays done across an app restart.
 *
 * Runs right after 00-theme-onboarding.local.e2e.ts, which completes the
 * onboarding and then switches to graphite through the AppBar palette
 * button. Every spec file launches a fresh app instance, so this spec's
 * instance IS the restart: it must boot with no onboarding dialog and
 * with the persisted preset applied.
 *
 * Structural selectors only — the run shares the developer's real
 * settings.json (any language).
 */

import { expect } from 'chai'

import {
  saveScreenshot,
  tauriInvoke,
  waitForMainUI,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/** Preset the previous spec leaves persisted (its last AppBar pick). */
const PERSISTED_PRESET = 'graphite'

describe('local real app: theme onboarding restart', () => {
  before(async function () {
    this.timeout(180_000)
    await waitForMainUI()
  })

  it('boots with no onboarding dialog and the persisted preset applied', async () => {
    // Let a (wrong) dialog mount before asserting its absence.
    await browser.pause(1_500)
    expect(await (await browser.$(S.DIALOG_CONTENT)).isExisting()).to.be.false

    const settings = await tauriInvoke<{ themePreset?: string }>('get_settings')
    expect(settings.themePreset).to.equal(PERSISTED_PRESET)

    expect(
      await browser.execute(() =>
        document.documentElement.getAttribute('data-theme-preset'),
      ),
    ).to.equal(PERSISTED_PRESET)
    await saveScreenshot('theme-onboarding', 'restart-no-dialog')
  })
})
