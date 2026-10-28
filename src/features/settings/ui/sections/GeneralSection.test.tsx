/**
 * GeneralSection suite (three-layer strategy — key wiring only).
 *
 * - useSettings stays real: assertions go through the seeded singleton
 *   store and the 'patch_settings' mockInvoke payload.
 * - Language changes go through updateLanguage (i18n reload + a single
 *   {language} patch — the former form double-persist is gone).
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { PAGE_DEFS, TOGGLEABLE_PAGES, pageKey } from '@/shared/layout/pages'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { GeneralSection } from './GeneralSection'

const toastSuccess = toast.success as unknown as Mock

const baseline: Settings = {
  dlOutputPath: '/downloads/out',
  language: 'ja',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
  disabledPages: [],
}

/** Returns the latest patch_settings payload (changed fields), or undefined. */
function lastSetSettings(): Partial<Settings> | undefined {
  const calls = mockInvoke.mock.calls.filter(
    (c: unknown[]) => c[0] === 'patch_settings',
  )
  const call = calls[calls.length - 1]
  return call?.[1]?.patch as Partial<Settings> | undefined
}

function seedSettings(partial: Partial<Settings> = {}) {
  vi.clearAllMocks()
  mockInvoke.mockResolvedValue(undefined)
  store.dispatch(setSettings({ ...baseline, ...partial }))
}

describe('GeneralSection', () => {
  it('renders the seeded language in the select', () => {
    seedSettings()
    renderWithProviders(<GeneralSection />)

    expect(
      screen.getByRole('combobox', { name: 'settings.language_label' }),
    ).toHaveTextContent('日本語')
  })

  it('changing the language persists exactly one {language} patch', async () => {
    seedSettings()
    const { user } = renderWithProviders(<GeneralSection />)

    const langSelect = screen.getByRole('combobox', {
      name: 'settings.language_label',
    })
    await user.click(langSelect)
    await user.click(screen.getByRole('option', { name: 'English' }))

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ language: 'en' }),
    )
    // The double-persist of the old form (updateLanguage + saveByForm) is
    // gone: only the single updateLanguage patch reaches the backend.
    const patches = mockInvoke.mock.calls.filter(
      (c: unknown[]) => c[0] === 'patch_settings',
    )
    expect(patches).toHaveLength(1)
    // Success is silent across all settings controls — no toast.
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('saves the startup page choice without a success toast', async () => {
    seedSettings()
    const { user } = renderWithProviders(<GeneralSection />)

    await user.click(
      screen.getByRole('combobox', { name: 'settings.startupPage_label' }),
    )
    await user.click(screen.getByRole('option', { name: 'nav.downloads' }))

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ startupPage: '/downloads' }),
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('shows the video-search entry as the startup page when unset or legacy', () => {
    // setSettings merges, so undefined must be seeded explicitly (earlier
    // tests leave '/downloads' behind); the trigger must display the
    // '/popular' default (pre-change: '/search'), never an empty value.
    seedSettings({ startupPage: undefined })
    const { unmount } = renderWithProviders(<GeneralSection />)

    expect(
      screen.getByRole('combobox', { name: 'settings.startupPage_label' }),
    ).toHaveTextContent('nav.videoSearch')
    unmount()

    // Pre-/popular settings.json stored '/video-search'; display
    // normalizes it while the stored value itself is left untouched.
    seedSettings({ startupPage: '/video-search' })
    renderWithProviders(<GeneralSection />)

    expect(
      screen.getByRole('combobox', { name: 'settings.startupPage_label' }),
    ).toHaveTextContent('nav.videoSearch')
    expect(store.getState().settings.startupPage).toBe('/video-search')
  })

  it('offers every enabled startup page from the registry', async () => {
    // Guards drift: options derive from the page registry (Radix
    // options carry no `value` attribute in the DOM, so labels are the
    // observable). /video-search is intentionally absent — it is a
    // transient results page owned by the /popular entry — and so is
    // /settings.
    seedSettings()
    const { user } = renderWithProviders(<GeneralSection />)

    await user.click(
      screen.getByRole('combobox', { name: 'settings.startupPage_label' }),
    )

    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).not.toContain('nav.settings')
    expect(labels).not.toContain('settings.title')
    expect([...labels].sort()).toEqual(
      PAGE_DEFS.filter((def) => pageKey(def) !== '/settings')
        .map((def) => def.labelKey)
        .sort(),
    )
  })

  it('excludes disabled pages from the startup options and display', async () => {
    // '/popular' hidden: not among the options, and the trigger falls
    // back to the first enabled option (/search) instead of an empty
    // value — IndexPage owns the actual launch redirect.
    seedSettings({ startupPage: '/popular', disabledPages: ['/popular'] })
    const { user } = renderWithProviders(<GeneralSection />)

    const trigger = screen.getByRole('combobox', {
      name: 'settings.startupPage_label',
    })
    expect(trigger).toHaveTextContent('nav.search')

    await user.click(trigger)
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).not.toContain('nav.videoSearch')
    expect(labels).toContain('nav.search')
  })

  it('changing the theme persists the new theme', async () => {
    seedSettings()
    const { user } = renderWithProviders(<GeneralSection />)

    const dark = screen.getByText('settings.theme_dark').closest('button')!
    await user.click(dark as HTMLElement)

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ theme: 'dark' }),
    )
  })

  it('changing the accent color persists the new accent', async () => {
    seedSettings()
    const { user } = renderWithProviders(<GeneralSection />)

    const blue = screen.getByText('settings.accent_blue').closest('button')!
    await user.click(blue as HTMLElement)

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ accentColor: 'blue' }),
    )
  })

  it('persists the font size picked with the slider keyboard', async () => {
    seedSettings({ fontSize: 14 })
    const { user } = renderWithProviders(<GeneralSection />)

    // Radix Slider: focus a thumb then step with the arrow keys
    const thumbs = screen.getAllByRole('slider')
    await user.click(thumbs[0]!)
    await user.keyboard('{ArrowRight}')

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ fontSize: 15 }),
    )
  })

  it.each([
    ['settings.show_github_stars_label', { showGithubStars: false }],
    ['settings.skip_splash_animation_label', { skipSplashAnimation: true }],
  ])('toggling %s persists it', async (labelKey, expected) => {
    seedSettings()
    const { user } = renderWithProviders(<GeneralSection />)

    const section = screen
      .getByText(labelKey)
      .closest('div.flex.items-center.justify-between')!
    await user.click(
      section.querySelector('button[role="switch"]') as HTMLElement,
    )

    await waitFor(() => expect(lastSetSettings()).toMatchObject(expected))
  })

  it('renders one divider per group boundary', () => {
    seedSettings()
    const { container } = renderWithProviders(<GeneralSection />)

    // One after the general toggles, one before the page-visibility
    // block.
    expect(container.querySelectorAll('[data-slot="separator"]')).toHaveLength(
      2,
    )
  })

  it('offers visibility toggles for hideable pages only', () => {
    seedSettings()
    const { container } = renderWithProviders(<GeneralSection />)

    const switches = container.querySelectorAll(
      'button[role="switch"][id^="page-visibility-"]',
    )
    expect(switches).toHaveLength(TOGGLEABLE_PAGES.length)
    // Required pages never get a toggle.
    expect(
      container.querySelector(
        '#page-visibility-search, #page-visibility-downloads, #page-visibility-settings',
      ),
    ).toBeNull()
  })

  it('toggling a page off and on persists the disabledPages list', async () => {
    seedSettings()
    const { user } = renderWithProviders(<GeneralSection />)

    // The GIF toggle row: its label also disambiguates from the
    // startup-page trigger, which never shows 'nav.gif'.
    const gifRow = () =>
      screen
        .getByText('nav.gif')
        .closest('div.flex.items-center.justify-between')!
    await user.click(
      gifRow().querySelector('button[role="switch"]') as HTMLElement,
    )
    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ disabledPages: ['/gif'] }),
    )

    // Re-query: the merged settings re-render may rebuild the row.
    await user.click(
      gifRow().querySelector('button[role="switch"]') as HTMLElement,
    )
    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ disabledPages: [] }),
    )
  })

  it('toggling a second page off keeps the already-disabled entry', async () => {
    seedSettings({ disabledPages: ['/trim'] })
    const { user } = renderWithProviders(<GeneralSection />)

    const gifSwitch = () =>
      screen
        .getByText('nav.gif')
        .closest('div.flex.items-center.justify-between')!
        .querySelector('button[role="switch"]') as HTMLElement
    await user.click(gifSwitch())

    // Appends instead of replacing; no duplicate-key path here.
    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({
        disabledPages: ['/trim', '/gif'],
      }),
    )
  })
})
