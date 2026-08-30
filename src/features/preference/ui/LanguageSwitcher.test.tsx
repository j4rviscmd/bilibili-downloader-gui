/**
 * LanguageSwitcher suite.
 *
 * useSettings is mocked (it has its own suite); the switcher is covered for
 * trigger rendering, dropdown option listing, and the persisted language
 * change through updateLanguage.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const settingsHook = vi.hoisted(() => ({
  settings: { language: 'en' as string },
  updateLanguage: vi.fn(),
  id2Label: (id: string) => `label-${id}`,
}))

vi.mock('@/features/settings', () => ({
  useSettings: () => settingsHook,
  languages: [
    { id: 'en', label: 'English' },
    { id: 'ja', label: '日本語' },
  ],
}))

import LanguageSwitcher from './LanguageSwitcher'

beforeAll(() => {
  // Radix dropdown interactions rely on pointer APIs happy-dom lacks.
  const stub = (name: string, impl: () => unknown) => {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, {
        value: impl,
        configurable: true,
      })
    }
  }
  stub('hasPointerCapture', () => false)
  stub('setPointerCapture', () => {})
  stub('releasePointerCapture', () => {})
})

beforeEach(() => {
  vi.clearAllMocks()
  settingsHook.settings = { language: 'en' }
})

describe('LanguageSwitcher', () => {
  it('renders the languages trigger with its aria-label', () => {
    renderWithProviders(<LanguageSwitcher />)

    expect(
      screen.getByRole('button', { name: 'settings.language' }),
    ).toBeInTheDocument()
  })

  it('lists every language and reports the picked one', async () => {
    const { user } = renderWithProviders(<LanguageSwitcher />)

    await user.click(screen.getByRole('button', { name: 'settings.language' }))

    await user.click(screen.getByRole('menuitemradio', { name: 'label-ja' }))

    expect(settingsHook.updateLanguage).toHaveBeenCalledWith('ja')
  })

  it('marks the active language in the radio group', async () => {
    const { user } = renderWithProviders(<LanguageSwitcher />)

    await user.click(screen.getByRole('button', { name: 'settings.language' }))

    expect(
      screen.getByRole('menuitemradio', { name: 'label-en' }),
    ).toHaveAttribute('data-state', 'checked')
    expect(
      screen.getByRole('menuitemradio', { name: 'label-ja' }),
    ).toHaveAttribute('data-state', 'unchecked')
  })
})
