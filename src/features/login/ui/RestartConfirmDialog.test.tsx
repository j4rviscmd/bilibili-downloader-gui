/**
 * RestartConfirmDialog suite.
 *
 * Covers the shared dialog contract: title/description render, confirm
 * fires onConfirm, the failure hint is conditional, and the dismissal
 * rules — overlay-click cancel is the only way out besides restart (no
 * close button, ESC disabled).
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RestartConfirmDialog } from './RestartConfirmDialog'

describe('RestartConfirmDialog', () => {
  it('renders the title, description and restart button while open', () => {
    renderWithProviders(
      <RestartConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />,
    )

    expect(screen.getByText('login.restartRequiredTitle')).toBeInTheDocument()
    expect(screen.getByText('login.restartRequired')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'login.restartNow' }),
    ).toBeInTheDocument()
  })

  it('calls onConfirm when the restart button is clicked', async () => {
    const onConfirm = vi.fn()
    const { user } = renderWithProviders(
      <RestartConfirmDialog open onCancel={vi.fn()} onConfirm={onConfirm} />,
    )

    await user.click(screen.getByRole('button', { name: 'login.restartNow' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows the failure hint only when failed', () => {
    const { rerender } = renderWithProviders(
      <RestartConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />,
    )
    expect(screen.queryByText('login.restartFailed')).toBeNull()

    rerender(
      <RestartConfirmDialog
        open
        failed
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('login.restartFailed')).toBeInTheDocument()
  })

  it('renders nothing while closed', () => {
    renderWithProviders(
      <RestartConfirmDialog
        open={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.queryByText('login.restartRequiredTitle')).toBeNull()
  })

  it('calls onCancel when dismissed via an overlay click', async () => {
    const onCancel = vi.fn()
    const { user } = renderWithProviders(
      <RestartConfirmDialog open onCancel={onCancel} onConfirm={vi.fn()} />,
    )

    // Radix sets pointer-events:none on body while the dialog is open —
    // the overlay itself is the cancel gesture both callers rely on
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    await user.click(overlay as HTMLElement)

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
  })

  it('ignores ESC: stays open and never calls onCancel', async () => {
    const onCancel = vi.fn()
    const { user } = renderWithProviders(
      <RestartConfirmDialog open onCancel={onCancel} onConfirm={vi.fn()} />,
    )

    await user.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('renders no close button — restart is the only button', () => {
    renderWithProviders(
      <RestartConfirmDialog open onCancel={vi.fn()} onConfirm={vi.fn()} />,
    )

    expect(
      within(screen.getByRole('dialog')).getAllByRole('button'),
    ).toHaveLength(1)
  })
})
