import { store } from '@/app/store'
import { setInitiated } from '@/features/init/model/initSlice'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { ThemeOnboardingDialog } from '@/features/settings/ui/ThemeOnboardingDialog'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const baseline: Settings = {
  dlOutputPath: '/downloads/out',
  language: 'ja',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

function seedSettings(partial: Partial<Settings> = {}) {
  vi.clearAllMocks()
  store.dispatch(
    setSettings({ ...baseline, themePreset: undefined, ...partial }),
  )
}

function lastPatch(): Partial<Settings> | undefined {
  const calls = mockInvoke.mock.calls.filter(
    (c: unknown[]) => c[0] === 'patch_settings',
  )
  const call = calls[calls.length - 1]
  return call?.[1]?.patch as Partial<Settings> | undefined
}

describe('ThemeOnboardingDialog', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    store.dispatch(setInitiated(true))
  })

  it('renders when initialized without a persisted themePreset', () => {
    seedSettings()
    renderWithProviders(<ThemeOnboardingDialog />)

    expect(
      screen.getByRole('dialog', { name: 'settings.themeOnboarding_title' }),
    ).toBeInTheDocument()
  })

  it('stays closed once a themePreset is persisted', () => {
    seedSettings({ themePreset: 'catppuccin' })
    renderWithProviders(<ThemeOnboardingDialog />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays closed before initialization finishes', () => {
    store.dispatch(setInitiated(false))
    seedSettings()
    renderWithProviders(<ThemeOnboardingDialog />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('preselects bilibili and persists it on a plain confirm', async () => {
    seedSettings()
    const user = userEvent.setup()
    renderWithProviders(<ThemeOnboardingDialog />)

    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText('settings.theme_bilibili').closest('button'),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(dialog).getByText('settings.themeOnboarding_cta'))

    await waitFor(() =>
      expect(lastPatch()).toMatchObject({
        themePreset: 'bilibili',
        theme: 'light',
      }),
    )
  })

  it('persists the picked preset and mode on confirm', async () => {
    seedSettings()
    const user = userEvent.setup()
    renderWithProviders(<ThemeOnboardingDialog />)

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('settings.theme_dark'))
    await user.click(
      within(dialog).getByText('settings.theme_catppuccin').closest('button')!,
    )
    // The live preview container carries the selection.
    expect(
      dialog.querySelector('[data-theme-preset="catppuccin"]'),
    ).not.toBeNull()
    await user.click(within(dialog).getByText('settings.themeOnboarding_cta'))

    await waitFor(() =>
      expect(lastPatch()).toMatchObject({
        themePreset: 'catppuccin',
        theme: 'dark',
      }),
    )
  })

  it('is mandatory: no close button, and Escape does not dismiss it', async () => {
    seedSettings()
    const user = userEvent.setup()
    renderWithProviders(<ThemeOnboardingDialog />)

    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).queryByRole('button', { name: /close/i }),
    ).not.toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(lastPatch()).toBeUndefined()
  })

  it('preselects the persisted light/dark mode', () => {
    seedSettings({ theme: 'dark' })
    renderWithProviders(<ThemeOnboardingDialog />)

    expect(screen.getByTestId('theme-onboarding-mode-dark')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('theme-onboarding-mode-light')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
