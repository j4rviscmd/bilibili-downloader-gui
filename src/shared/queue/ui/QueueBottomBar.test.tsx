/**
 * QueueBottomBar suite.
 *
 * Seeds the real store's queue slice and locks the bar's visibility rule
 * (hasActive), count/rate display, and whole-area navigation to
 * /downloads.
 */

import { store } from '@/app/store'
import { setProgress } from '@/shared/progress/progressSlice'
import { renderWithProviders, resetQueue, seedSession } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QueueBottomBar } from './QueueBottomBar'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

/** Echoes the current location so bar navigation is observable. */
function LocationEcho() {
  const { pathname } = useLocation()
  return <div data-testid="location">{pathname}</div>
}

function renderBar(route = '/search') {
  return renderWithProviders(
    <Routes>
      <Route path="/search" element={<QueueBottomBar />} />
      <Route path="/downloads" element={<LocationEcho />} />
    </Routes>,
    { route },
  )
}

describe('QueueBottomBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueue()
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
    const slots = document.querySelectorAll(
      '[data-queue-avatar-target] [data-slot="avatar"]',
    )
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
})
