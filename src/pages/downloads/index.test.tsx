/**
 * Downloads page suite.
 *
 * Seeds the real store's queue slice and locks the page's wiring: session
 * cards in FIFO order, the cancel-all / clear-finished toolbar matrix, and
 * the empty state.
 */

import { store } from '@/app/store'
import DownloadsContent from '@/pages/downloads'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { setProgress } from '@/shared/progress/progressSlice'
import { renderWithProviders, resetQueue, seedSession } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

describe('DownloadsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueue()
  })

  it('shows the empty state when the queue has no sessions', () => {
    renderWithProviders(
      <TooltipProvider>
        <DownloadsContent />
      </TooltipProvider>,
      { route: '/downloads' },
    )

    expect(screen.getByText('queue.title')).toBeInTheDocument()
    expect(screen.getByText('queue.empty')).toBeInTheDocument()
    // Cancel-all is disabled without active work.
    expect(
      screen.getByRole('button', { name: 'downloadStatus.cancel_all' }),
    ).toBeDisabled()
  })

  it('renders one parent card per session with part rows', () => {
    seedSession('BVfirst', [
      { partIndex: 1, cid: 1, status: 'running' },
      { partIndex: 2, cid: 2, status: 'pending' },
    ])
    seedSession('BVsecond', [{ partIndex: 1, cid: 9, status: 'done' }])

    renderWithProviders(
      <TooltipProvider>
        <DownloadsContent />
      </TooltipProvider>,
      { route: '/downloads' },
    )

    expect(screen.getByText('BVfirst')).toBeInTheDocument()
    expect(screen.getByText('BVsecond')).toBeInTheDocument()
    // Part rows carry the E2E data-status anchor.
    expect(
      document.querySelectorAll('[data-status]').length,
    ).toBeGreaterThanOrEqual(3)
    expect(
      screen.getAllByText('downloadStatus.status_downloading').length,
    ).toBeGreaterThan(0)
  })

  it('parent cancel routes through cancelParentDownloads and settles the subtree', async () => {
    const parentId = seedSession('BVcancel', [
      { partIndex: 1, cid: 1, status: 'running' },
    ])
    const { user } = renderWithProviders(
      <TooltipProvider>
        <DownloadsContent />
      </TooltipProvider>,
      { route: '/downloads' },
    )

    // The parent header's cancel (part rows render their own cancel
    // buttons for active parts — the header one comes first).
    await user.click(
      screen.getAllByRole('button', { name: 'actions.cancel' })[0],
    )

    // The whole subtree settles to cancelled (the cancelDownload(parentId)
    // trap — a pending parent has no backend token and would leave its
    // children running — must not reproduce here).
    await vi.waitFor(() => {
      const statuses = store
        .getState()
        .queue.filter(
          (i) => i.downloadId === parentId || i.parentId === parentId,
        )
        .map((i) => i.status)
      expect(statuses.every((s) => s === 'cancelled')).toBe(true)
    })
  })

  it('enables clear-finished only when a session is settled', async () => {
    seedSession('BVsettled', [{ partIndex: 1, cid: 1, status: 'done' }])
    seedSession('BVactive', [{ partIndex: 1, cid: 2, status: 'running' }])

    const { user } = renderWithProviders(
      <TooltipProvider>
        <DownloadsContent />
      </TooltipProvider>,
      { route: '/downloads' },
    )
    const clear = screen.getByRole('button', { name: 'queue.clear_finished' })
    expect(clear).toBeEnabled()

    await user.click(clear)

    // The settled session is gone; the active one remains.
    expect(screen.queryByText('BVsettled')).not.toBeInTheDocument()
    expect(screen.getByText('BVactive')).toBeInTheDocument()
    expect(store.getState().queue.some((i) => i.videoId === 'BVsettled')).toBe(
      false,
    )
  })

  it('clear-finished also clears the progress entries of removed parts', async () => {
    const parentId = seedSession('BVprog', [
      { partIndex: 1, cid: 1, status: 'done' },
    ])
    store.dispatch(
      setProgress({
        downloadId: `${parentId}-p1`,
        stage: 'complete',
        percentage: 100,
        transferRate: 0,
        isComplete: true,
      } as never),
    )
    expect(store.getState().progress.length).toBeGreaterThan(0)

    const { user } = renderWithProviders(
      <TooltipProvider>
        <DownloadsContent />
      </TooltipProvider>,
      { route: '/downloads' },
    )
    await user.click(
      screen.getByRole('button', { name: 'queue.clear_finished' }),
    )

    expect(store.getState().progress.length).toBe(0)
  })
})
