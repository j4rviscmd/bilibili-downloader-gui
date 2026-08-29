/**
 * HistoryExportDialog suite.
 *
 * Format radio selection flows into onExport; success closes the dialog,
 * failure surfaces the error via the locally mocked toast.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'
import HistoryExportDialog from './HistoryExportDialog'

const toastError = toast.error as unknown as Mock

describe('HistoryExportDialog', () => {
  // Typed vi.fn so the mocks satisfy the component's callback props
  const onExport = vi.fn<(format: 'json' | 'csv') => Promise<void>>()
  const onOpenChange = vi.fn<(open: boolean) => void>()

  beforeEach(() => {
    vi.clearAllMocks()
    onExport.mockResolvedValue(undefined)
  })

  function renderDialog() {
    return renderWithProviders(
      <HistoryExportDialog
        open
        onOpenChange={onOpenChange}
        onExport={onExport}
      />,
    )
  }

  it('exports with the json format by default', async () => {
    const { user } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'actions.submit' }))

    expect(onExport).toHaveBeenCalledWith('json')
  })

  it('exports csv after switching the radio', async () => {
    const { user } = renderDialog()

    await user.click(screen.getByLabelText('history.exportCsv'))
    await user.click(screen.getByRole('button', { name: 'actions.submit' }))

    expect(onExport).toHaveBeenCalledWith('csv')
  })

  it('closes the dialog on successful export', async () => {
    const { user } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'actions.submit' }))

    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('toasts the error message and stays open on failure', async () => {
    onExport.mockRejectedValue(new Error('disk full'))
    const { user } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'actions.submit' }))

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith('disk full'))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('cancel closes without exporting', async () => {
    const { user } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'actions.cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onExport).not.toHaveBeenCalled()
  })
})
