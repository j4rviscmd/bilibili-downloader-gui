/**
 * StorageSection suite.
 *
 * useSettings stays real; the lib-path flow is asserted through the
 * mockInvoke payloads ('get_current_lib_path' / 'update_lib_path').
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { open } from '@tauri-apps/plugin-dialog'
import { StorageSection } from './StorageSection'

const mockOpen = open as unknown as Mock

const baseline: Settings = {
  dlOutputPath: '/downloads/out',
  language: 'ja',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

describe('StorageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_current_lib_path') return Promise.resolve('/lib')
      return Promise.resolve(undefined)
    })
    store.dispatch(setSettings(baseline))
  })

  it('shows the current lib path fetched on mount', async () => {
    renderWithProviders(<StorageSection />)

    expect(await screen.findByDisplayValue('/lib')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('get_current_lib_path')
  })

  it('updates the library path through the directory dialog', async () => {
    mockOpen.mockResolvedValue('/Volumes/External/Lib')
    const { user } = renderWithProviders(<StorageSection />)

    await user.click(
      screen.getByRole('button', { name: 'settings.lib_path_button' }),
    )

    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.some(
          (c: unknown[]) =>
            c[0] === 'update_lib_path' &&
            (c[1] as Record<string, unknown>)?.newPath ===
              '/Volumes/External/Lib',
        ),
      ).toBe(true),
    )
  })

  it('shows the error placeholder when the current lib path fails to load', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_current_lib_path')
        return Promise.reject(new Error('no lib'))
      return Promise.resolve(undefined)
    })
    renderWithProviders(<StorageSection />)

    expect(
      await screen.findByDisplayValue('settings.lib_path_error'),
    ).toBeInTheDocument()
  })

  it('keeps the lib path when the directory dialog is cancelled', async () => {
    mockOpen.mockResolvedValue(null)
    const { user } = renderWithProviders(<StorageSection />)

    await user.click(
      screen.getByRole('button', { name: 'settings.lib_path_button' }),
    )

    expect(
      mockInvoke.mock.calls.some((c: unknown[]) => c[0] === 'update_lib_path'),
    ).toBe(false)
  })
})
