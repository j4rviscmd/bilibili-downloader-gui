import { store } from '@/app/store'
import type { Progress } from '@/shared/progress/types'
import { clearQueue, enqueue } from '@/shared/queue'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import ProgressStatusBar from './ProgressStatusBar'

/** Builds a full Progress object with test-friendly defaults. */
function createProgress(overrides: Partial<Progress> = {}): Progress {
  return {
    downloadId: 'dl-1',
    deltaTime: 1,
    filesize: 45.6,
    downloaded: 12.3,
    transferRate: 512,
    percentage: 27,
    elapsedTime: 125,
    isComplete: false,
    ...overrides,
  }
}

describe('ProgressStatusBar', () => {
  beforeEach(() => {
    // The real singleton store persists between tests; clear the queue.
    store.dispatch(clearQueue())
  })

  it('renders elapsed, speed, sizes and percentage', () => {
    renderWithProviders(
      <ProgressStatusBar progress={createProgress({ elapsedTime: 3725 })} />,
    )

    // 3725s -> 1h2m5s
    expect(
      screen.getByText('progress.elapsed:', { exact: false }),
    ).toHaveTextContent('1h2m5s')
    expect(
      screen.getByText('progress.speed:', { exact: false }),
    ).toHaveTextContent('512KB/s')
    expect(screen.getByText('12.3mb/45.6mb')).toBeInTheDocument()
    expect(screen.getByText('27%')).toBeInTheDocument()
  })

  it('switches to MB/s at 1000 KB/s or above', () => {
    renderWithProviders(
      <ProgressStatusBar progress={createProgress({ transferRate: 1536 })} />,
    )

    expect(
      screen.getByText('progress.speed:', { exact: false }),
    ).toHaveTextContent('1.5MB/s')
  })

  it('omits speed and size when filesize is unknown', () => {
    renderWithProviders(
      <ProgressStatusBar progress={createProgress({ filesize: null! })} />,
    )

    expect(
      screen.getByText('progress.elapsed:', { exact: false }),
    ).toHaveTextContent('2m5s')
    expect(screen.getByText('27%')).toBeInTheDocument()
    expect(
      screen.queryByText('progress.speed:', { exact: false }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('12.3mb/45.6mb')).not.toBeInTheDocument()
  })

  it('shows the queued label instead of elapsed for a pending queue item', () => {
    store.dispatch(enqueue({ downloadId: 'dl-1', status: 'pending' }))

    renderWithProviders(<ProgressStatusBar progress={createProgress()} />)

    expect(screen.getByText('progress.queued')).toBeInTheDocument()
    expect(
      screen.queryByText('progress.elapsed:', { exact: false }),
    ).not.toBeInTheDocument()
  })
})
