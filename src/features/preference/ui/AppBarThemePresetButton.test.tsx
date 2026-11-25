import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppBarThemePresetButton from './AppBarThemePresetButton'

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
  mockInvoke.mockResolvedValue(undefined)
  store.dispatch(setSettings({ ...baseline, ...partial }))
}

function lastPatch(): Partial<Settings> | undefined {
  const calls = mockInvoke.mock.calls.filter(
    (c: unknown[]) => c[0] === 'patch_settings',
  )
  const call = calls[calls.length - 1]
  return call?.[1]?.patch as Partial<Settings> | undefined
}

describe('AppBarThemePresetButton', () => {
  beforeEach(() => {
    // jsdom lacks Popover's ancestor scroll APIs; the content renders in
    // a portal either way, so stub what radix measures.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders the palette button by default', () => {
    seedSettings()
    renderWithProviders(<AppBarThemePresetButton />)

    expect(
      screen.getByRole('button', { name: 'settings.themePreset_label' }),
    ).toBeInTheDocument()
  })

  it('is hidden when showAppBarThemePreset is false', () => {
    seedSettings({ showAppBarThemePreset: false })
    renderWithProviders(<AppBarThemePresetButton />)

    expect(
      screen.queryByRole('button', { name: 'settings.themePreset_label' }),
    ).not.toBeInTheDocument()
  })

  it('persists the preset picked from the popover', async () => {
    seedSettings({ showAppBarThemePreset: true })
    const user = userEvent.setup()
    renderWithProviders(<AppBarThemePresetButton />)

    await user.click(
      screen.getByRole('button', { name: 'settings.themePreset_label' }),
    )
    const card = screen
      .getByText('settings.theme_catppuccin')
      .closest('button')!
    await user.click(card as HTMLElement)

    await waitFor(() =>
      expect(lastPatch()).toMatchObject({ themePreset: 'catppuccin' }),
    )
  })
})
