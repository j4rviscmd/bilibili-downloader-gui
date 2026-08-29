/**
 * HistoryContent (history page) suite.
 *
 * Covers the page-level wiring that does not live in features/history/ui:
 * search box -> setSearch, and the export flow -> save dialog +
 * writeTextFile. useHistory and usePendingDownload are mocked at the hook
 * level (F3 covers the hooks themselves); all UI children are real.
 */

import { renderWithProviders } from '@/test/test-utils'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const historyHook = vi.hoisted(() => ({
  state: {
    entries: [],
    loading: false,
    error: null,
    filters: { status: 'all' as const },
    searchQuery: '',
  },
  setSearch: vi.fn(),
  updateFilters: vi.fn(),
  exportData: vi.fn().mockResolvedValue('[{"id":"1"}]'),
}))

vi.mock('@/features/history/hooks/useHistory', () => ({
  useHistory: () => ({ ...historyHook.state, ...historyHook }),
}))
vi.mock('@/shared/hooks/usePendingDownload', () => ({
  usePendingDownload: () => vi.fn(),
}))
vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'
import { HistoryContent } from './index'

const mockSave = save as unknown as Mock
const mockWriteTextFile = writeTextFile as unknown as Mock
const toastSuccess = toast.success as unknown as Mock

describe('HistoryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    historyHook.exportData.mockResolvedValue('[{"id":"1"}]')
    mockSave.mockResolvedValue(null)
    mockWriteTextFile.mockResolvedValue(undefined)
  })

  it('propagates search input to setSearch', async () => {
    const { user } = renderWithProviders(<HistoryContent />)

    await user.type(
      screen.getByPlaceholderText('history.searchPlaceholder'),
      'abc',
    )

    expect(historyHook.setSearch).toHaveBeenLastCalledWith('c')
  })

  it('exports via save dialog and writeTextFile, then toasts success', async () => {
    mockSave.mockResolvedValue('/out/history.json')
    const { user } = renderWithProviders(<HistoryContent />)

    // Open the export dialog, then submit with the default json format
    await user.click(
      screen.getByRole('button', { name: 'history.exportTitle' }),
    )
    await user.click(screen.getByRole('button', { name: 'actions.submit' }))

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'history.json' }),
      ),
    )
    expect(mockWriteTextFile).toHaveBeenCalledWith(
      '/out/history.json',
      '[{"id":"1"}]',
    )
    expect(toastSuccess).toHaveBeenCalledWith('history.exportSuccess')
  })

  it('skips writing when the save dialog is cancelled', async () => {
    mockSave.mockResolvedValue(null)
    const { user } = renderWithProviders(<HistoryContent />)

    await user.click(
      screen.getByRole('button', { name: 'history.exportTitle' }),
    )
    await user.click(screen.getByRole('button', { name: 'actions.submit' }))

    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    expect(mockWriteTextFile).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})
