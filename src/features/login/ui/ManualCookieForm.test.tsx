/**
 * ManualCookieForm suite.
 *
 * Covers the paste form contract: apply button gating, the success path
 * (invoke called, field cleared, onApplied fired), and error mapping for
 * backend ERR::MANUAL_COOKIE_* codes.
 */

import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ManualCookieForm from './ManualCookieForm'

describe('ManualCookieForm', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('disables the apply button until text is entered', async () => {
    const { user } = renderWithProviders(<ManualCookieForm />)

    const apply = screen.getByRole('button', {
      name: 'login.manualCookieApply',
    })
    expect(apply).toBeDisabled()

    await user.type(screen.getByLabelText('login.manualCookie'), 'SESSDATA=abc')

    expect(apply).toBeEnabled()
  })

  it('invokes apply_manual_cookie with the pasted text, clears the field and fires onApplied', async () => {
    const onApplied = vi.fn()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'fetch_user') {
        return Promise.resolve({
          code: 0,
          message: '',
          data: { mid: 1, uname: 'u', isLogin: true },
          hasCookie: true,
        })
      }
      return Promise.resolve(undefined)
    })
    const { user } = renderWithProviders(
      <ManualCookieForm onApplied={onApplied} />,
    )

    const textarea = screen.getByLabelText('login.manualCookie')
    await user.type(textarea, 'SESSDATA=abc; bili_jct=jct')
    await user.click(
      screen.getByRole('button', { name: 'login.manualCookieApply' }),
    )

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('apply_manual_cookie', {
        text: 'SESSDATA=abc; bili_jct=jct',
      })
    })
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalled()
    })
    // The secret must not linger in the field after a successful apply.
    expect(textarea).toHaveValue('')
  })

  it('shows the mapped error for ERR::MANUAL_COOKIE_INVALID without firing onApplied', async () => {
    const onApplied = vi.fn()
    mockInvoke.mockRejectedValue('ERR::MANUAL_COOKIE_INVALID')
    const { user } = renderWithProviders(
      <ManualCookieForm onApplied={onApplied} />,
    )

    await user.type(
      screen.getByLabelText('login.manualCookie'),
      'SESSDATA=stale',
    )
    await user.click(
      screen.getByRole('button', { name: 'login.manualCookieApply' }),
    )

    await waitFor(() => {
      expect(screen.getByText('login.manualCookieInvalid')).toBeInTheDocument()
    })
    expect(onApplied).not.toHaveBeenCalled()
    // Failed apply keeps the text so the user can edit and retry.
    expect(screen.getByLabelText('login.manualCookie')).toHaveValue(
      'SESSDATA=stale',
    )
  })
})
