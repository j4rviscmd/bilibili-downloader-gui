/**
 * useSettings suite.
 *
 * Asserts the invoke commands ('get_settings' / 'patch_settings' /
 * 'update_lib_path') and their arguments via the global mockInvoke, plus
 * Redux effects on the real singleton store. Toast content is asserted via
 * a local toast spy (identity t from the centralized i18n mock).
 */

import { store } from '@/app/store'
import { languages } from '@/features/settings/language/languages'
import { setOpenDialog, setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { useSettings } from '@/features/settings/useSettings'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import i18next from 'i18next'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const toastSuccess = toast.success as unknown as Mock
const toastError = toast.error as unknown as Mock
const mockChangeLanguage = i18next.changeLanguage as unknown as Mock

const baseline: Settings = {
  dlOutputPath: '',
  language: 'en',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

const backendSettings: Settings = {
  ...baseline,
  dlOutputPath: '/downloads',
  language: 'ja',
}

function mockCommands(handlers: Record<string, unknown>) {
  mockInvoke.mockImplementation((cmd: string) => {
    const handler = handlers[cmd]
    if (handler instanceof Error) return Promise.reject(handler)
    if (handler !== undefined) return Promise.resolve(handler)
    return Promise.resolve(undefined)
  })
}

describe('useSettings', () => {
  beforeEach(() => {
    store.dispatch(setSettings(baseline))
    store.dispatch(setOpenDialog(false))
    vi.clearAllMocks()
  })

  describe('getSettings', () => {
    it('fetches via get_settings and dispatches setSettings', async () => {
      mockCommands({ get_settings: backendSettings })
      const { result } = renderHookWithStore(() => useSettings())

      const fetched = await result.current.getSettings()

      expect(mockInvoke).toHaveBeenCalledWith('get_settings')
      expect(fetched).toEqual(backendSettings)
      expect(store.getState().settings.dlOutputPath).toBe('/downloads')
      expect(store.getState().settings.language).toBe('ja')
    })
  })

  describe('updateSettings', () => {
    it('dispatches first, then persists via patch_settings', async () => {
      mockCommands({ patch_settings: undefined })
      const { result } = renderHookWithStore(() => useSettings())

      // Issue #563: updateSettings sends only the changed fields.
      await result.current.updateSettings({ dlOutputPath: '/downloads' })

      expect(mockInvoke).toHaveBeenCalledWith('patch_settings', {
        patch: { dlOutputPath: '/downloads' },
      })
      expect(store.getState().settings.dlOutputPath).toBe('/downloads')
    })

    it('keeps the dispatched state but throws when the backend rejects', async () => {
      mockCommands({ patch_settings: new Error('ERR::SAVE_FAILED') })
      const { result } = renderHookWithStore(() => useSettings())

      await expect(
        result.current.updateSettings({ dlOutputPath: '/downloads' }),
      ).rejects.toThrow('ERR::SAVE_FAILED')
      // The Redux update happened before the failed persistence call.
      expect(store.getState().settings.dlOutputPath).toBe('/downloads')
    })
  })

  describe('saveByForm', () => {
    it('toasts settings.save_success on success', async () => {
      mockCommands({ patch_settings: undefined })
      const { result } = renderHookWithStore(() => useSettings())

      await result.current.saveByForm({ dlOutputPath: '/downloads' })

      expect(toastSuccess).toHaveBeenCalledWith('settings.save_success')
      expect(toastError).not.toHaveBeenCalled()
    })

    it('maps ERR:SETTINGS_PATH_NOT_DIRECTORY to a localized description', async () => {
      mockCommands({
        patch_settings: new Error('ERR:SETTINGS_PATH_NOT_DIRECTORY'),
      })
      const { result } = renderHookWithStore(() => useSettings())

      await result.current.saveByForm({ dlOutputPath: '/downloads' })

      expect(toastError).toHaveBeenCalledWith('settings.save_failed_generic', {
        duration: 10000,
        description: 'settings.path_not_directory',
      })
    })

    it('maps ERR:SETTINGS_PATH_NOT_EXIST to a localized description', async () => {
      mockCommands({ patch_settings: new Error('ERR:SETTINGS_PATH_NOT_EXIST') })
      const { result } = renderHookWithStore(() => useSettings())

      await result.current.saveByForm({ dlOutputPath: '/downloads' })

      expect(toastError).toHaveBeenCalledWith('settings.save_failed_generic', {
        duration: 10000,
        description: 'settings.path_not_exist',
      })
    })

    it('falls back to the raw error string for unknown codes', async () => {
      mockCommands({ patch_settings: new Error('weird failure') })
      const { result } = renderHookWithStore(() => useSettings())

      await result.current.saveByForm({ dlOutputPath: '/downloads' })

      expect(toastError).toHaveBeenCalledWith('settings.save_failed_generic', {
        duration: 10000,
        // updateSettings re-wraps the backend error, so the raw fallback is
        // double-prefixed: Error(String(Error('weird failure'))).
        description: 'Error: Error: weird failure',
      })
    })

    it('silent mode suppresses both success and error toasts', async () => {
      mockCommands({ patch_settings: new Error('ERR::SAVE_FAILED') })
      const { result } = renderHookWithStore(() => useSettings())

      await result.current.saveByForm({ dlOutputPath: '/downloads' }, true)

      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })
  })

  describe('updateOpenDialog', () => {
    it('dispatches setOpenDialog', () => {
      const { result } = renderHookWithStore(() => useSettings())

      result.current.updateOpenDialog(true)
      expect(store.getState().settings.dialogOpen).toBe(true)

      result.current.updateOpenDialog(false)
      expect(store.getState().settings.dialogOpen).toBe(false)
    })
  })

  describe('updateLanguage', () => {
    it('changes i18n language and persists the settings', async () => {
      mockCommands({ patch_settings: undefined })
      const { result } = renderHookWithStore(() => useSettings())

      await result.current.updateLanguage('ja')

      expect(mockChangeLanguage).toHaveBeenCalledWith('ja')
      expect(mockInvoke).toHaveBeenCalledWith('patch_settings', {
        patch: { language: 'ja' },
      })
      expect(store.getState().settings.language).toBe('ja')
    })
  })

  describe('updateLibPath', () => {
    it('moves the lib, refetches settings, and toasts success', async () => {
      mockCommands({
        update_lib_path: undefined,
        get_settings: backendSettings,
      })
      const { result } = renderHookWithStore(() => useSettings())

      await result.current.updateLibPath('/Volumes/External')

      expect(mockInvoke).toHaveBeenCalledWith('update_lib_path', {
        newPath: '/Volumes/External',
      })
      expect(mockInvoke).toHaveBeenCalledWith('get_settings')
      expect(toastSuccess).toHaveBeenCalledWith(
        'settings.lib_path_change_success',
      )
    })

    it('toasts the raw error and keeps the old settings on failure', async () => {
      mockCommands({ update_lib_path: new Error('ERR::PERMISSION') })
      const { result } = renderHookWithStore(() => useSettings())

      await result.current.updateLibPath('/Volumes/External')

      expect(toastError).toHaveBeenCalledWith(
        'settings.lib_path_change_error',
        {
          duration: 10000,
          description: 'Error: ERR::PERMISSION',
        },
      )
      expect(mockInvoke).not.toHaveBeenCalledWith('get_settings')
    })
  })

  describe('id2Label', () => {
    it('returns the language label for a known id', () => {
      const { result } = renderHookWithStore(() => useSettings())
      const jaLabel = languages.find((l) => l.id === 'ja')!.label

      expect(result.current.id2Label('ja')).toBe(jaLabel)
    })

    it('returns the id itself when unknown', () => {
      const { result } = renderHookWithStore(() => useSettings())

      expect(result.current.id2Label('xx' as 'ja')).toBe('xx')
    })
  })
})
