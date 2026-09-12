/**
 * useFontSizeEffect suite: the document root font-size follows the
 * settings store (mirrors the useThemeEffect suite shape). Regression for
 * the multi-instance gap: a became-visible re-fetch updates the store but
 * only this effect writes the rem-basis DOM.
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { renderHookWithStore } from '@/test/test-utils'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useFontSizeEffect } from './useFontSizeEffect'

describe('useFontSizeEffect', () => {
  beforeEach(() => {
    document.documentElement.style.fontSize = ''
    store.dispatch(setSettings({ fontSize: 14 }))
  })

  it('applies the stored font size on mount', () => {
    store.dispatch(setSettings({ fontSize: 18 }))

    renderHookWithStore(() => useFontSizeEffect())

    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('re-applies when the store value changes afterwards (multi-instance refresh)', () => {
    const { store } = renderHookWithStore(() => useFontSizeEffect())
    expect(document.documentElement.style.fontSize).toBe('14px')

    // The settings page's became-visible re-fetch lands as a store patch;
    // the effect — not any handler — must write the new rem basis.
    act(() => {
      store.dispatch(setSettings({ fontSize: 20 }))
    })

    expect(document.documentElement.style.fontSize).toBe('20px')
  })

  it('falls back to the default for an unset value', () => {
    store.dispatch(setSettings({ fontSize: undefined }))

    renderHookWithStore(() => useFontSizeEffect())

    expect(document.documentElement.style.fontSize).toBe('14px')
  })
})
