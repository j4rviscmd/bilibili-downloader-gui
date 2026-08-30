/**
 * ToggleThemeButton suite.
 *
 * The animate-ui Switch reflects the current theme and reports dark/light
 * through setTheme on toggle.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import ToggleThemeButton from './ToggleThemeButton'

beforeAll(() => {
  // Radix Switch calls pointer capture APIs; happy-dom lacks them.
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

function switchRoot() {
  return screen.getByRole('switch')
}

describe('ToggleThemeButton', () => {
  it('reflects light theme as unchecked', () => {
    renderWithProviders(<ToggleThemeButton theme="light" setTheme={vi.fn()} />)

    expect(switchRoot()).toHaveAttribute('data-state', 'unchecked')
    expect(switchRoot()).toHaveAttribute('aria-checked', 'false')
  })

  it('reflects dark theme as checked', () => {
    renderWithProviders(<ToggleThemeButton theme="dark" setTheme={vi.fn()} />)

    expect(switchRoot()).toHaveAttribute('data-state', 'checked')
    expect(switchRoot()).toHaveAttribute('aria-checked', 'true')
  })

  it('reports dark when toggled on', async () => {
    const setTheme = vi.fn()
    const { user } = renderWithProviders(
      <ToggleThemeButton theme="light" setTheme={setTheme} />,
    )

    await user.click(switchRoot())

    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  it('reports light when toggled off', async () => {
    const setTheme = vi.fn()
    const { user } = renderWithProviders(
      <ToggleThemeButton theme="dark" setTheme={setTheme} />,
    )

    await user.click(switchRoot())

    expect(setTheme).toHaveBeenCalledWith('light')
  })
})
