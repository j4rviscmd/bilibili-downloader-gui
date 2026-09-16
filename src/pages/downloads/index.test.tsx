/**
 * Downloads page suite.
 *
 * Seeds the real store's queue slice and locks the page's wiring: the
 * FLAT part list in drain order, the cancel-all / clear-finished toolbar
 * matrix, per-row cancel, and the empty state.
 */

import { store } from '@/app/store'
import DownloadsContent from '@/pages/downloads'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { setProgress } from '@/shared/progress/progressSlice'
import {
  mockInvoke,
  renderWithProviders,
  resetQueue,
  seedSession,
} from '@/test/test-utils'
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

  it('shows the empty state when the queue has no parts', () => {
    renderWithProviders(<DownloadsContent />, { route: '/downloads' })

    expect(screen.getByText('queue.title')).toBeInTheDocument()
    expect(screen.getByText('queue.empty')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'downloadStatus.cancel_all' }),
    ).toBeDisabled()
  })

  it('renders a flat drain-ordered list with one row per part', () => {
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

    // Flat rows: one row per part (3 parts across 2 enqueue clicks, all
    // carrying the data-status E2E anchor — no per-click grouping).
    expect(document.querySelectorAll('[data-status]').length).toBe(3)
    expect(document.querySelectorAll('[data-status]').length).toBe(3)
    expect(
      screen.getAllByText('downloadStatus.status_downloading').length,
    ).toBeGreaterThan(0)
  })

  it('splits rows into Downloading / Queued / Finished sections', () => {
    seedSession('BVsec', [
      { partIndex: 1, cid: 1, status: 'running' },
      { partIndex: 2, cid: 2, status: 'pending' },
      { partIndex: 3, cid: 3, status: 'done' },
      { partIndex: 4, cid: 4, status: 'cancelled' },
    ])

    renderWithProviders(
      <TooltipProvider>
        <DownloadsContent />
      </TooltipProvider>,
      { route: '/downloads' },
    )

    expect(screen.getByText('queue.section_downloading')).toBeInTheDocument()
    expect(screen.getByText('queue.section_queued')).toBeInTheDocument()
    expect(screen.getByText('queue.section_finished')).toBeInTheDocument()
    // Section headers carry their row counts.
    expect(screen.getByText('queue.section_queued').textContent).toContain(
      '(1)',
    )
    expect(screen.getByText('queue.section_finished').textContent).toContain(
      '(2)',
    )
  })

  it('part-row cancel settles that part only (siblings untouched)', async () => {
    seedSession('BVcancel', [
      { partIndex: 1, cid: 1, status: 'running' },
      { partIndex: 2, cid: 2, status: 'pending' },
    ])
    const { user } = renderWithProviders(
      <TooltipProvider>
        <DownloadsContent />
      </TooltipProvider>,
      { route: '/downloads' },
    )

    // First cancel button = first row in drain order (the running part 1).
    mockInvoke.mockResolvedValueOnce(true)
    await user.click(
      screen.getAllByRole('button', { name: 'actions.cancel' })[0],
    )

    await vi.waitFor(() => {
      const queue = store.getState().queue
      const first = queue.find((i) => i.kind === 'part' && i.cid === 1)
      const second = queue.find((i) => i.kind === 'part' && i.cid === 2)
      expect(first?.status).toBe('cancelled')
      expect(second?.status).toBe('pending')
    })
  })

  it('enables clear-finished only when a part is settled', async () => {
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

    // The settled part is gone; the active one remains.
    expect(
      screen.getByText('downloadStatus.status_downloading'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('downloadStatus.status_completed'),
    ).not.toBeInTheDocument()
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

  it('shows the cancelled label exactly once per part (badge only)', () => {
    // Regression (verification): PartDownloadProgress also renders a
    // cancelled label row — without suppression the status read twice.
    seedSession('BVdup', [{ partIndex: 1, cid: 1, status: 'cancelled' }])

    renderWithProviders(
      <TooltipProvider>
        <DownloadsContent />
      </TooltipProvider>,
      { route: '/downloads' },
    )

    expect(screen.getAllByText('downloadStatus.status_cancelled').length).toBe(
      1,
    )
    expect(
      screen.queryByText('video.download_cancelled'),
    ).not.toBeInTheDocument()
  })
})
