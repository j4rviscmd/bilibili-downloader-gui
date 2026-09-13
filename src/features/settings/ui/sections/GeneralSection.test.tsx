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
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { GeneralSection } from './GeneralSection'

const baseline: Settings = {
  dlOutputPath: '/downloads/out',
  language: 'ja',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
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

    expect(screen.getByRole('combobox')).toHaveTextContent('日本語')
  })

  it('changing the language persists exactly one {language} patch', async () => {
    seedSettings()
    const { user } = renderWithProviders(<GeneralSection />)

    await user.click(screen.getByRole('combobox'))
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

    expect(container.querySelectorAll('[data-slot="separator"]')).toHaveLength(
      1,
    )
  })
})
