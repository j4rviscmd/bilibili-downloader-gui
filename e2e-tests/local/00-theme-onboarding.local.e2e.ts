/**
 * LOCAL-REAL E2E: theme onboarding for a pre-preset (legacy accentColor)
 * user, and the AppBar palette button — end to end against the real
 * backend (settings.json via patch_settings).
 *
 * MUST stay the first spec of the run (00- prefix): wdio.local.conf.ts
 * seeds the legacy user into the live settings.json in onPrepare, and
 * every spec file launches a fresh app instance that opens with the
 * mandatory onboarding dialog until this spec completes it. The `after`
 * hook force-confirms a dialog a failed test left open.
 *
 * Not covered here — it needs the developer's real settings.json moved
 * aside for a launch (see the first-run E2E issue): the brand-new-user
 * route (no settings.json → language setup → onboarding with Bilibili
 * Pink preselected). The restart check lives in the next spec,
 * 01-theme-onboarding-restart.local.e2e.ts.
 *
 * Structural selectors only — the run shares the developer's real
 * settings.json (any language), so asserts use testids, ARIA state, the
 * root data-theme-preset attribute, get_settings, and the file on disk.
 */

import { expect } from 'chai'

import {
  readPersistedSettings,
  saveScreenshot,
  tauriInvoke,
  waitForMainUI,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/** shadcn dialog's built-in close button — must not exist on the
 * mandatory onboarding. */
const DIALOG_CLOSE = '[data-slot="dialog-close"]'

/** ThemePresetGrid cards (data-testid={`theme-preset-${id}`}). */
const presetCard = (id: string) => `[data-testid="theme-preset-${id}"]`

const CTA = '[data-testid="theme-onboarding-cta"]'
const MODE_DARK = '[data-testid="theme-onboarding-mode-dark"]'
const PREVIEW = '[data-testid="theme-onboarding-preview"]'
const APPBAR_PALETTE = '[data-testid="appbar-theme-preset-button"]'

type Persisted = {
  themePreset?: string
  theme?: string
  accentColor?: string
}

async function persisted(): Promise<Persisted> {
  return tauriInvoke<Persisted>('get_settings')
}

async function isPressed(selector: string): Promise<boolean> {
  const el = await browser.$(selector)
  return (await el.getAttribute('aria-pressed')) === 'true'
}

describe('local real app: theme onboarding (legacy accentColor user)', () => {
  before(async function () {
    this.timeout(180_000)
    await waitForMainUI()
  })

  after(async function () {
    // Never leave the mandatory dialog open for the specs after this one.
    const dialog = await browser.$(S.DIALOG_CONTENT)
    if (await dialog.isExisting()) {
      const cta = await browser.$(CTA)
      if (await cta.isExisting()) await cta.click()
    }
  })

  it('opens as a mandatory dialog with the legacy blue preselected', async () => {
    const dialog = await browser.$(S.DIALOG_CONTENT)
    await dialog.waitForExist({ timeout: 15_000 })

    // Pre-preset state: no themePreset, the legacy alias still there.
    expect((await persisted()).themePreset).to.be.undefined
    expect((await persisted()).accentColor).to.equal('blue')

    expect(await isPressed(presetCard('bilibili-blue'))).to.be.true
    expect(await isPressed(presetCard('bilibili'))).to.be.false
    expect(
      await (await browser.$(PREVIEW)).getAttribute('data-theme-preset'),
    ).to.equal('bilibili-blue')

    // Mandatory: no close button, and Escape does not dismiss it.
    expect(await (await browser.$(DIALOG_CLOSE)).isExisting()).to.be.false
    await browser.keys(['Escape'])
    await browser.pause(500)
    expect(await dialog.isExisting()).to.be.true
    await saveScreenshot('theme-onboarding', 'legacy-blue-preselected')
  })

  it('live-updates the preview for preset and light/dark picks', async () => {
    await (await browser.$(presetCard('claude'))).click()
    await browser.waitUntil(
      async () =>
        (await (await browser.$(PREVIEW)).getAttribute('data-theme-preset')) ===
        'claude',
      { timeout: 5_000, timeoutMsg: 'preview never switched to claude' },
    )
    expect(await isPressed(presetCard('claude'))).to.be.true
    expect(await isPressed(presetCard('bilibili-blue'))).to.be.false

    await (await browser.$(MODE_DARK)).click()
    expect(await isPressed(MODE_DARK)).to.be.true
    // Only the preview flips; the app root keeps the pre-confirm theme.
    expect(
      await browser.execute(() =>
        document
          .querySelector('[data-testid="theme-onboarding-preview"]')
          ?.classList.contains('dark'),
      ),
    ).to.be.true
    await saveScreenshot('theme-onboarding', 'claude-dark-preview')
  })

  it('confirming persists preset + mode, prunes unknown keys, closes', async () => {
    await (await browser.$(CTA)).click()
    await (
      await browser.$(S.DIALOG_CONTENT)
    ).waitForExist({ timeout: 10_000, reverse: true })

    // Applied to the app root immediately.
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.documentElement.getAttribute('data-theme-preset'),
        )) === 'claude' &&
        (await browser.execute(() =>
          document.documentElement.classList.contains('dark'),
        )),
      { timeout: 10_000, timeoutMsg: 'app root never switched to claude/dark' },
    )

    // Persisted.
    const settings = await persisted()
    expect(settings.themePreset).to.equal('claude')
    expect(settings.theme).to.equal('dark')

    // settings.json mirrors the type: the seeded unknown key is pruned,
    // the declared legacy alias stays until its field is removed.
    const disk = await readPersistedSettings()
    expect(disk).not.to.have.property('e2eStaleKey')
    expect(disk.accentColor).to.equal('blue')
    expect(disk.themePreset).to.equal('claude')
  })

  it('the AppBar palette button switches the theme without onboarding', async () => {
    const trigger = await browser.$(APPBAR_PALETTE)
    await trigger.waitForExist({ timeout: 10_000 })
    await trigger.click()
    const graphite = await browser.$(presetCard('graphite'))
    await graphite.waitForExist({ timeout: 10_000 })
    expect(await isPressed(presetCard('claude'))).to.be.true
    await graphite.click()

    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.documentElement.getAttribute('data-theme-preset'),
        )) === 'graphite',
      { timeout: 10_000, timeoutMsg: 'app root never switched to graphite' },
    )
    await browser.waitUntil(
      async () => (await persisted()).themePreset === 'graphite',
      { timeout: 10_000, timeoutMsg: 'themePreset never persisted graphite' },
    )
    expect(await (await browser.$(S.DIALOG_CONTENT)).isExisting()).to.be.false
    await saveScreenshot('theme-onboarding', 'appbar-graphite')
  })
})
