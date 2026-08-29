/**
 * OpenLogsButton suite.
 *
 * The button is a thin shell around the 'reveal_log_file' invoke; assert
 * the command name on success and the localized toast on failure.
 */

import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenLogsButton } from './OpenLogsButton'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'

const toastError = toast.error as unknown as Mock

describe('OpenLogsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
  })

  it('reveals the log file via invoke on click', async () => {
    const { user } = renderWithProviders(<OpenLogsButton />)

    await user.click(
      screen.getByRole('button', { name: 'settings.open_logs_button' }),
    )

    expect(mockInvoke).toHaveBeenCalledWith('reveal_log_file')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts the localized failure when invoke rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'))
    const { user } = renderWithProviders(<OpenLogsButton />)

    await user.click(
      screen.getByRole('button', { name: 'settings.open_logs_button' }),
    )

    // The toast fires in the async catch; wait for it.
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('settings.open_logs_failed'),
    )
  })
})
