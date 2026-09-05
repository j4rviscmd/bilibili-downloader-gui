import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import type { Progress } from '@/shared/progress/types'
import {
  createPartDownloadStatus,
  mockInvoke,
  renderWithProviders,
} from '@/test/test-utils'
import { error as logError } from '@tauri-apps/plugin-log'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PartDownloadStatus } from '../hooks/usePartDownloadStatus'
import { PartDownloadProgress } from './PartDownloadProgress'

/** Builds a Progress stage entry. */
function stage(overrides: Partial<Progress> = {}): Progress {
  return {
    downloadId: 'dl-1-p1',
    deltaTime: 1,
    filesize: 45.6,
    downloaded: 12.3,
    transferRate: 512,
    percentage: 50,
    elapsedTime: 10,
    isComplete: false,
    stage: 'audio',
    ...overrides,
  }
}

/** Builds an idle PartDownloadStatus with per-test overrides. */
const createMockStatus = (overrides: Partial<PartDownloadStatus> = {}) =>
  createPartDownloadStatus({ downloadId: 'dl-1-p1', ...overrides })

/** Renders the component inside the TooltipProvider its stage icons need. */
function setup(status: PartDownloadStatus, onCancel?: () => void) {
  return renderWithProviders(
    <TooltipProvider>
      <PartDownloadProgress status={status} onCancel={onCancel} />
    </TooltipProvider>,
  )
}

describe('PartDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Component chains .catch() on invoke's return
    mockInvoke.mockResolvedValue(undefined)
  })

  it('renders nothing for a part with no activity', () => {
    const { container } = setup(createMockStatus())

    expect(container.innerHTML).toBe('')
  })

  it('shows the pending state with a cancel action', async () => {
    const onCancel = vi.fn()
    const { user: actor } = setup(
      createMockStatus({ isPending: true }),
      onCancel,
    )

    expect(screen.getByText('video.download_pending')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'actions.cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('omits the cancel button when no handler is provided', () => {
    setup(createMockStatus({ isPending: true }))

    expect(
      screen.queryByRole('button', { name: 'actions.cancel' }),
    ).not.toBeInTheDocument()
  })

  it('shows the Mosaic indicator next to a stage icon until its first event', () => {
    // Running with only an audio entry: audio shows numbers, video still
    // waits in its fetch/speed-check window with the indicator
    setup(
      createMockStatus({
        isDownloading: true,
        progressEntries: [stage({ stage: 'audio', percentage: 10 })],
      }),
    )

    expect(screen.getByText('10')).toBeInTheDocument()
    // The indicator wrapper (Mosaic) appears in exactly the waiting column
    const indicators = document.querySelectorAll('.flex-1.justify-center')
    expect(indicators).toHaveLength(1)
  })

  it('shows no indicator once both download stages report progress', () => {
    setup(
      createMockStatus({
        isDownloading: true,
        progressEntries: [
          stage({ stage: 'audio', percentage: 30 }),
          stage({ stage: 'video', percentage: 40 }),
        ],
      }),
    )

    expect(document.querySelector('.flex-1.justify-center')).toBeNull()
  })

  it('renders per-stage progress while downloading', async () => {
    const onCancel = vi.fn()
    const { user: actor } = setup(
      createMockStatus({
        isDownloading: true,
        progressEntries: [
          stage({ stage: 'audio', percentage: 50 }),
          stage({ stage: 'video', percentage: 75, transferRate: 1536 }),
        ],
      }),
      onCancel,
    )

    // Both stage percentages and the MB/s formatting appear
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('1.5MB/s')).toBeInTheDocument()
    // Both stages show their downloaded/total sizes
    expect(screen.getAllByText('12.3')).toHaveLength(2)
    expect(screen.getAllByText('45.6')).toHaveLength(2)
    // Merge waits until audio and video both finish
    expect(
      screen.getByText('video.stage_merge: video.stage_waiting'),
    ).toBeInTheDocument()

    // The icon cancel button is the only button in the downloading row
    await actor.click(screen.getByRole('button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('disables cancellation during the merge stage', () => {
    setup(
      createMockStatus({
        isDownloading: true,
        progressEntries: [
          stage({ stage: 'video', percentage: 100 }),
          stage({ stage: 'merge', percentage: 40 }),
        ],
      }),
      vi.fn(),
    )

    expect(screen.getByText('video.stage_merge')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    // Killing ffmpeg mid-merge races the final write, so no cancel control
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the complete state with open/reveal actions', async () => {
    const { user: actor } = setup(
      createMockStatus({
        isComplete: true,
        outputPath: '/downloads/video.mp4',
      }),
    )

    expect(screen.getByText('video.download_complete')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'video.open_file' }))
    expect(mockInvoke).toHaveBeenCalledWith('open_file', {
      path: '/downloads/video.mp4',
    })
  })

  it('maps a known backend error code to its translation key', () => {
    setup(createMockStatus({ hasError: true, errorMessage: 'ERR::DISK_FULL' }))

    expect(screen.getByText('video.disk_full')).toBeInTheDocument()
  })

  it('shows the raw message for unknown errors and a generic label for none', () => {
    const { rerender } = setup(
      createMockStatus({ hasError: true, errorMessage: 'boom' }),
    )
    expect(screen.getByText('boom')).toBeInTheDocument()

    // No store context is needed, so a bare rerender is safe here
    rerender(
      <TooltipProvider>
        <PartDownloadProgress status={createMockStatus({ hasError: true })} />
      </TooltipProvider>,
    )
    expect(screen.getByText('video.download_failed_part')).toBeInTheDocument()
  })

  it('shows the cancelling state in place of the pending row', () => {
    setup(createMockStatus({ isPending: true, isCancelling: true }))

    expect(screen.getByText('video.download_cancelling')).toBeInTheDocument()
    expect(screen.queryByText('video.download_pending')).not.toBeInTheDocument()
  })

  it('prefers the complete view when cancel lands after a finished merge', () => {
    setup(createMockStatus({ isComplete: true, isCancelled: true }))

    expect(screen.getByText('video.download_complete')).toBeInTheDocument()
    expect(
      screen.queryByText('video.download_cancelled'),
    ).not.toBeInTheDocument()
  })

  it('reveals the finished file in the folder', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const { user: actor } = setup(
      createMockStatus({
        isComplete: true,
        outputPath: '/downloads/video.mp4',
      }),
    )

    await actor.click(screen.getByRole('button', { name: 'video.open_folder' }))

    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_folder', {
      path: '/downloads/video.mp4',
    })
  })

  it('swallows an open_file rejection through the logger', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('no association'))
    const { user: actor } = setup(
      createMockStatus({
        isComplete: true,
        outputPath: '/downloads/video.mp4',
      }),
    )

    // Must not throw out of the click handler
    await actor.click(screen.getByRole('button', { name: 'video.open_file' }))

    expect(logError).toHaveBeenCalledWith(
      '[FE] Failed to open file: Error: no association',
    )
  })

  it('swallows a reveal_in_folder rejection through the logger', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('finder error'))
    const { user: actor } = setup(
      createMockStatus({
        isComplete: true,
        outputPath: '/downloads/video.mp4',
      }),
    )

    await actor.click(screen.getByRole('button', { name: 'video.open_folder' }))

    expect(logError).toHaveBeenCalledWith(
      '[FE] Failed to reveal in folder: Error: finder error',
    )
  })
})
