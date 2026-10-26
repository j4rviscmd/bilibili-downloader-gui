/**
 * QueueBottomBar suite.
 *
 * Seeds the real store's queue slice and locks the bar's visibility rule
 * (hasActive), count/rate display, and whole-area navigation to
 * /downloads.
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { setProgress } from '@/shared/progress/progressSlice'
import { renderWithProviders, resetQueue, seedSession } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatKbps, QueueBottomBar } from './QueueBottomBar'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

/** Echoes the current location (path + query) so navigation is observable. */
function LocationEcho() {
  const { pathname, search } = useLocation()
  return (
    <div data-testid="location">
      {pathname}
      {search}
    </div>
  )
}

function renderBar(route = '/search') {
  return renderWithProviders(
    <Routes>
      <Route path="/search" element={<QueueBottomBar />} />
      <Route path="/downloads" element={<LocationEcho />} />
      <Route path="/settings" element={<LocationEcho />} />
    </Routes>,
    { route },
  )
}

describe('QueueBottomBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueue()
    // Reset the shared settings store: the speed-limit tests below enable
    // a cap, and a leftover `true` would leak the sub-label into the
    // unlimited tests (single store across the suite).
    store.dispatch(
      setSettings({
        downloadSpeedLimitEnabled: false,
        downloadSpeedLimitKbps: 1000,
      }),
    )
  })

  it('stays unmounted while the queue is idle', () => {
    renderBar()
    expect(screen.queryByTestId('queue-bottom-bar')).not.toBeInTheDocument()
  })

  it('appears with the part count while a session drains', () => {
    seedSession('BVbar1', [
      { partIndex: 1, cid: 1, status: 'done' },
      { partIndex: 2, cid: 2, status: 'running' },
    ])

    renderBar()

    expect(screen.getByTestId('queue-bottom-bar')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('stays mounted once everything settles (persistent until cleared)', () => {
    // Verification decision: the bar only hides on a fully EMPTY queue —
    // popping out on settle jiggled every page's layout.
    seedSession('BVbar2', [
      { partIndex: 1, cid: 1, status: 'done' },
      { partIndex: 2, cid: 2, status: 'cancelled' },
    ])

    renderBar()

    expect(screen.getByTestId('queue-bottom-bar')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('navigates to /downloads when the bar area is clicked', async () => {
    seedSession('BVbar3', [{ partIndex: 1, cid: 1, status: 'running' }])
    const { user } = renderBar('/search')

    await user.click(screen.getByTestId('queue-bottom-bar'))

    expect(
      await screen.findByTestId('location', undefined, { timeout: 2000 }),
    ).toHaveTextContent('/downloads')
  })

  it('caps avatars at 5 with a +N remainder tile', () => {
    for (let i = 1; i <= 7; i++) {
      seedSession(`BVmany${i}`, [{ partIndex: 1, cid: i, status: 'running' }])
    }

    renderBar()

    // 6 visible avatar slots: 5 thumbnails + the +2 remainder tile.
    const slots = document.querySelectorAll('[data-slot="avatar"]')
    expect(slots).toHaveLength(6)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('shows the aggregate transfer rate of running parts', () => {
    const parentId = seedSession('BVbar4', [
      { partIndex: 1, cid: 1, status: 'running' },
    ])
    store.dispatch(
      setProgress({
        downloadId: `${parentId}-p1`,
        stage: 'audio',
        percentage: 10,
        transferRate: 1500,
        isComplete: false,
      } as never),
    )

    renderBar()

    expect(screen.getByText('1.5 MB/s')).toBeInTheDocument()
  })

  it('shows the concurrency link only while downloads are active', () => {
    seedSession('BVcap1', [{ partIndex: 1, cid: 1, status: 'running' }])
    const { unmount } = renderBar()
    expect(screen.getByTestId('concurrency-link')).toBeInTheDocument()
    unmount()

    // Settled-only queue: the bar persists (hasAnyItems) but the link
    // zone renders blank (hasActive) — same gating as the rate/limit
    // button and the concurrency link.
    resetQueue()
    seedSession('BVcap1', [
      { partIndex: 1, cid: 1, status: 'done' },
      { partIndex: 2, cid: 2, status: 'cancelled' },
    ])
    renderBar()
    expect(screen.getByTestId('queue-bottom-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('concurrency-link')).not.toBeInTheDocument()
  })

  it('clicking the concurrency link opens settings, not /downloads', async () => {
    // The link sits inside the bar's whole-area /downloads button — the
    // stopPropagation wrapper must let the link's own navigation win.
    seedSession('BVcap2', [{ partIndex: 1, cid: 1, status: 'running' }])
    const { user } = renderBar('/search')

    await user.click(screen.getByTestId('concurrency-link'))

    expect(await screen.findByTestId('location')).toHaveTextContent('/settings')
  })

  it('shows the rate as the speed-limit entry while unlimited, deep-linking into Settings', async () => {
    seedSession('BVrate1', [{ partIndex: 1, cid: 1, status: 'running' }])
    const { user } = renderBar('/search')

    // The affordance name lives on aria-label/tooltip, not text content.
    const link = screen.getByTestId('speed-limit-link')
    expect(link).toHaveAttribute('aria-label', 'downloadStatus.speed_limit_set')
    expect(link).not.toHaveTextContent('downloadStatus.speed_limit_set')
    await user.click(link)

    expect(
      await screen.findByTestId('location', undefined, { timeout: 2000 }),
    ).toHaveTextContent('/settings?category=download&anchor=speed-limit')
  })

  it('shows the active cap as a faint sub-label under the rate, deep-linking into Settings', async () => {
    store.dispatch(
      setSettings({
        downloadSpeedLimitEnabled: true,
        downloadSpeedLimitKbps: 500,
      }),
    )
    const parentId = seedSession('BVrate2', [
      { partIndex: 1, cid: 1, status: 'running' },
    ])
    store.dispatch(
      setProgress({
        downloadId: `${parentId}-p1`,
        stage: 'audio',
        percentage: 10,
        transferRate: 1500,
        isComplete: false,
      } as never),
    )
    const { user } = renderBar('/search')

    const link = screen.getByTestId('speed-limit-link')
    // Both lines: the live rate and, beneath it, the cap.
    expect(link).toHaveTextContent('1.5 MB/s')
    expect(link).toHaveTextContent('500 KB/s')
    expect(link).toHaveAttribute(
      'aria-label',
      'downloadStatus.speed_limit_tooltip',
    )
    await user.click(link)

    expect(
      await screen.findByTestId('location', undefined, { timeout: 2000 }),
    ).toHaveTextContent('/settings?category=download&anchor=speed-limit')
  })

  it('shows a dash placeholder while active but nothing has transferred', () => {
    // Running part with no progress yet: the entry button must render,
    // and a 0-transfer queue shows the dash placeholder (verification
    // decision — a blank line read as a broken control).
    seedSession('BVrate4', [{ partIndex: 1, cid: 1, status: 'running' }])
    renderBar()

    const link = screen.getByTestId('speed-limit-link')
    expect(link).toBeInTheDocument()
    expect(link).toHaveTextContent('- MB/s')
  })

  it('skips the cap sub-label while the limit is on but no kbps is stored', () => {
    // Optional field (settings predating it): enabled with no stored
    // value renders the rate only — the guard must skip, not format, it.
    store.dispatch(
      setSettings({
        downloadSpeedLimitEnabled: true,
        downloadSpeedLimitKbps: undefined,
      }),
    )
    const parentId = seedSession('BVrate5', [
      { partIndex: 1, cid: 1, status: 'running' },
    ])
    store.dispatch(
      setProgress({
        downloadId: `${parentId}-p1`,
        stage: 'audio',
        percentage: 10,
        transferRate: 1500,
        isComplete: false,
      } as never),
    )
    renderBar()

    const link = screen.getByTestId('speed-limit-link')
    expect(link).toHaveTextContent('1.5 MB/s')
    expect(link).not.toHaveTextContent(/KB\/s/)
    expect(link).toHaveAttribute(
      'aria-label',
      'downloadStatus.speed_limit_tooltip',
    )
  })

  it('hides the speed-limit entry once downloads settle', () => {
    resetQueue()
    seedSession('BVrate3', [
      { partIndex: 1, cid: 1, status: 'done' },
      { partIndex: 2, cid: 2, status: 'cancelled' },
    ])
    renderBar()

    expect(screen.getByTestId('queue-bottom-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('speed-limit-link')).not.toBeInTheDocument()
  })

  it('scales the display unit at 1000 kb/s (decimal, one fraction digit)', () => {
    const cases: Array<[number, string]> = [
      [100, '100 KB/s'],
      [999, '999 KB/s'],
      [1000, '1 MB/s'],
      [1500, '1.5 MB/s'],
      [10000, '10 MB/s'],
      [10000000, '10,000 MB/s'],
    ]
    for (const [kbps, expected] of cases) {
      expect(formatKbps(kbps)).toBe(expected)
    }
  })
})
