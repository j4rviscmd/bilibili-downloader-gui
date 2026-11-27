import { expect } from 'chai'
import fs from 'node:fs'

import {
  readPersistedSettings,
  saveScreenshot,
  SETTINGS_PATH,
  switchToWindow,
  tauriInvoke,
  waitForMainUI,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

const DIALOG_CLOSE = '[data-slot="dialog-close"]'
const BILIBILI_CARD = '[data-testid="theme-preset-bilibili"]'
const MODE_LIGHT = '[data-testid="theme-onboarding-mode-light"]'
const MODE_DARK = '[data-testid="theme-onboarding-mode-dark"]'
const PREVIEW = '[data-testid="theme-onboarding-preview"]'

type Persisted = { language?: string; theme?: string; themePreset?: string }

async function isPressed(selector: string): Promise<boolean> {
  const el = await browser.$(selector)
  return (await el.getAttribute('aria-pressed')) === 'true'
}

let setupLanguage: string

// Note: wdio.local.conf.ts moves the developer's settings.json to
// settings.json.e2e-hold for this spec's session only (beforeSession →
// afterSession), so this spec always boots a settings-less app and the
// developer's file is back on disk afterwards (issue #977).
describe('local real app: brand-new user (no settings.json)', () => {
  before(async function () {
    this.timeout(180_000)
    await (
      await browser.$(S.SETUP_LANGUAGE_SELECT)
    ).waitForExist({ timeout: 60_000 })
  })

  it('starts in the splash language setup with no settings.json', async () => {
    expect(fs.existsSync(SETTINGS_PATH)).to.be.false
    expect(await browser.getWindowHandles()).to.deep.equal(['splash'])
    await saveScreenshot('first-run', 'splash-language-setup')
  })

  it('language setup persists the language and hands off to main', async () => {
    const select = await browser.$(S.SETUP_LANGUAGE_SELECT)
    setupLanguage = await select.getValue()
    await (await browser.$(S.SETUP_LANGUAGE_CONTINUE)).click()

    // Why: poll the file on the Node side — the splash closes as soon as
    // the language is saved and the webdriver session stays pinned to it,
    // so driver commands sent mid-close fail with "no such window"
    // (issue #977).
    await browser.waitUntil(
      async () =>
        fs.existsSync(SETTINGS_PATH) &&
        (await readPersistedSettings()).language === setupLanguage,
      { timeout: 15_000, timeoutMsg: 'settings.json never held language' },
    )
    expect(await readPersistedSettings()).not.to.have.property('themePreset')

    await switchToWindow('main')
    await waitForMainUI()
    expect(await browser.getWindowHandle()).to.equal('main')
  })

  it('opens the mandatory onboarding with Bilibili and light preselected', async () => {
    const dialog = await browser.$(S.DIALOG_CONTENT)
    await dialog.waitForExist({ timeout: 15_000 })

    const settings = await tauriInvoke<Persisted>('get_settings')
    expect(settings.language).to.equal(setupLanguage)
    expect(settings.themePreset).to.be.undefined
    expect(settings.theme).to.be.undefined

    expect(await isPressed(BILIBILI_CARD)).to.be.true
    expect(await isPressed(MODE_LIGHT)).to.be.true
    expect(await isPressed(MODE_DARK)).to.be.false
    expect(
      await (await browser.$(PREVIEW)).getAttribute('data-theme-preset'),
    ).to.equal('bilibili')
    expect(await (await browser.$(DIALOG_CLOSE)).isExisting()).to.be.false
    await saveScreenshot('first-run', 'onboarding-bilibili-light')
  })

  it('confirming writes language, theme and themePreset, no accentColor', async () => {
    await (await browser.$(S.THEME_ONBOARDING_CTA)).click()
    await (
      await browser.$(S.DIALOG_CONTENT)
    ).waitForExist({ timeout: 10_000, reverse: true })

    const root = await browser.execute(() => ({
      preset: document.documentElement.getAttribute('data-theme-preset'),
      light: document.documentElement.classList.contains('light'),
      dark: document.documentElement.classList.contains('dark'),
    }))
    expect(root).to.deep.equal({ preset: null, light: true, dark: false })

    const disk = await readPersistedSettings()
    expect(disk.language).to.equal(setupLanguage)
    expect(disk.theme).to.equal('light')
    expect(disk.themePreset).to.equal('bilibili')
    expect(disk).not.to.have.property('accentColor')
  })
})
