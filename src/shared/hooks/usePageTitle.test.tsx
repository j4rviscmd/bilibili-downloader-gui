/**
 * usePageTitle suite. The global i18n mock (src/test/setup.ts) makes `t`
 * return the key, so titles assert as raw translation keys.
 */

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePageTitle } from './usePageTitle'

afterEach(() => {
  vi.unstubAllEnvs()
  document.title = ''
})

describe('usePageTitle', () => {
  it('prefixes (dev) under the Vite dev server (MODE=development)', () => {
    vi.stubEnv('MODE', 'development')
    renderHook(() => usePageTitle('audio.title'))
    expect(document.title).toBe('(dev) audio.title - app.title')
  })

  it('omits the prefix in production mode', () => {
    vi.stubEnv('MODE', 'production')
    renderHook(() => usePageTitle('audio.title'))
    expect(document.title).toBe('audio.title - app.title')
  })
})
