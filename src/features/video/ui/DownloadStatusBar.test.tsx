import { store } from '@/app/store'
import { initPartInputs, resetInput } from '@/features/video/model/inputSlice'
import { clearProgress, setProgress } from '@/shared/progress/progressSlice'
import { clearQueue, enqueue } from '@/shared/queue'
import type { Progress } from '@/shared/ui/Progress'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DownloadStatusBar } from './DownloadStatusBar'

const baseProgress: Progress = {
  downloadId: '',
  deltaTime: 0,
  filesize: 0,
  downloaded: 0,
  transferRate: 0,
  percentage: 0,
  elapsedTime: 0,
  isComplete: false,
}

/**
 * Seeds a parent with its children; children drive parent aggregation and
 * the resolved parent (last enqueued).
 */
function seedSession(
  children: Array<{ id: string; status: 'pending' | 'running' | 'done' }>,
) {
  const parentId = 'parent-1'
  store.dispatch(enqueue({ downloadId: parentId, status: 'pending' }))
  children.forEach(({ id, status }) =>
    store.dispatch(enqueue({ downloadId: id, parentId, status })),
  )
}

beforeEach(() => {
  store.dispatch(clearQueue())
  store.dispatch(clearProgress())
  store.dispatch(resetInput())
  mockInvoke.mockResolvedValue(0)
})

describe('DownloadStatusBar', () => {
  it('renders nothing with an empty queue', () => {
    renderWithProviders(<DownloadStatusBar />)

    expect(
      screen.queryByRole('button', { name: 'downloadStatus.cancel_all' }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing once the session has fully settled', () => {
    seedSession([{ id: 'parent-1-p1', status: 'done' }])

    renderWithProviders(<DownloadStatusBar />)

    expect(
      screen.queryByRole('button', { name: 'downloadStatus.cancel_all' }),
    ).not.toBeInTheDocument()
  })

  it('shows counts and cancel-all while parts are active', async () => {
    store.dispatch(
      initPartInputs([
        {
          cid: 1,
          page: 1,
          title: 'Episode One',
          videoQuality: '80',
          audioQuality: '30216',
          selected: true,
          duration: 60,
        },
        {
          cid: 2,
          page: 2,
          title: 'Episode Two',
          videoQuality: '80',
          audioQuality: '30216',
          selected: true,
          duration: 60,
        },
      ]),
    )
    seedSession([
      { id: 'parent-1-p1', status: 'done' },
      { id: 'parent-1-p2', status: 'running' },
    ])

    const { user } = renderWithProviders(<DownloadStatusBar />)

    // 1 done of 2 non-cancelled parts
    expect(await screen.findByText('1/2')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'downloadStatus.cancel_all' }),
    )

    expect(mockInvoke).toHaveBeenCalledWith('cancel_all_downloads', {
      // The parent (running via aggregation) and the running child; the
      // done child is not cancellable
      downloadIds: ['parent-1', 'parent-1-p2'],
    })
  })

  it('disables cancel-all while any part is merging', async () => {
    seedSession([{ id: 'parent-1-p1', status: 'running' }])
    store.dispatch(
      setProgress({
        ...baseProgress,
        downloadId: 'parent-1-p1',
        stage: 'merge',
        percentage: 10,
      }),
    )

    renderWithProviders(<DownloadStatusBar />)

    const button = await screen.findByRole('button', {
      name: 'downloadStatus.cancel_all',
    })
    expect(button).toBeDisabled()
  })
})
