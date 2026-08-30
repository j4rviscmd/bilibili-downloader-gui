/**
 * HistoryContent (history page) suite.
 *
 * Covers the page-level wiring that does not live in features/history/ui:
 * search box -> setSearch, and the export flow -> save dialog +
 * writeTextFile. useHistory and usePendingDownload are mocked at the hook
 * level (F3 covers the hooks themselves); all UI children are real.
 */

import { renderWithProviders } from '@/test/test-utils'
import { confirm, save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const historyHook = vi.hoisted(() => ({
  state: {
    entries: [] as Array<{ id: string }>,
    loading: false,
    error: null,
    filters: { status: 'all' as const },
    searchQuery: '',
  },
  setSearch: vi.fn(),
  updateFilters: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
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
const mockConfirm = confirm as unknown as Mock
const toastSuccess = toast.success as unknown as Mock
const toastError = toast.error as unknown as Mock

describe('HistoryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    historyHook.state.entries = []
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

  it('toasts the raw message when the export throws an Error', async () => {
    mockSave.mockResolvedValue('/out/history.csv')
    historyHook.exportData.mockRejectedValue(new Error('disk full'))
    const { user } = renderWithProviders(<HistoryContent />)

    await user.click(
      screen.getByRole('button', { name: 'history.exportTitle' }),
    )
    await user.click(screen.getByRole('button', { name: 'actions.submit' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('disk full'))
  })

  it('toasts the generic message when the export rejects without Error', async () => {
    mockSave.mockResolvedValue('/out/history.json')
    historyHook.exportData.mockRejectedValue('boom')
    const { user } = renderWithProviders(<HistoryContent />)

    await user.click(
      screen.getByRole('button', { name: 'history.exportTitle' }),
    )
    await user.click(screen.getByRole('button', { name: 'actions.submit' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('history.exportFailed'),
    )
  })

  it('clears all entries only after the confirm dialog accepts', async () => {
    historyHook.state.entries = [{ id: '1' }]
    const { user } = renderWithProviders(<HistoryContent />)

    const clearButton = screen.getByRole('button', { name: 'history.clearAll' })
    expect(clearButton).toBeEnabled()

    mockConfirm.mockResolvedValueOnce(false)
    await user.click(clearButton)
    expect(historyHook.clear).not.toHaveBeenCalled()

    mockConfirm.mockResolvedValueOnce(true)
    await user.click(clearButton)
    expect(historyHook.clear).toHaveBeenCalledTimes(1)
  })

  it('disables clear-all while the history is empty', () => {
    renderWithProviders(<HistoryContent />)

    expect(
      screen.getByRole('button', { name: 'history.clearAll' }),
    ).toBeDisabled()
  })

  it('propagates filter changes to updateFilters', async () => {
    const { user } = renderWithProviders(<HistoryContent />)

    // HistoryFilters dropdown: trigger shows the active filter label
    await user.click(screen.getByRole('button', { name: 'history.filterAll' }))
    await user.click(
      screen.getByRole('menuitem', { name: 'history.filterFailed' }),
    )

    expect(historyHook.updateFilters).toHaveBeenCalledWith({
      status: 'failed',
    })
  })
})
