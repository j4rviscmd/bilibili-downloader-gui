import type { PartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import {
  createPartDownloadStatus,
  mockInvoke,
  renderWithProviders,
} from '@/test/test-utils'
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PartCompactCard } from './PartCompactCard'

/** Idle/queued status fixture for the card props. */
const status = createPartDownloadStatus

function setup(props: Partial<Parameters<typeof PartCompactCard>[0]> = {}) {
  const onCancel = vi.fn()
  const onThumbnailClick = vi.fn()
  const utils = renderWithProviders(
    <TooltipProvider>
      <PartCompactCard
        page={2}
        title="Episode Two"
        thumbnailUrl="https://img.example/t.jpg"
        status={status()}
        isQueued
        isActive={false}
        hasEmbeddedAudio={false}
        {...props}
        onThumbnailClick={props.onThumbnailClick ?? onThumbnailClick}
        onCancel={props.onCancel ?? onCancel}
      />
    </TooltipProvider>,
  )
  return { ...utils, onCancel, onThumbnailClick }
}

describe('PartCompactCard', () => {
  it('renders the part number and title', () => {
    setup()

    expect(screen.getByText('P2')).toBeInTheDocument()
    expect(screen.getByText('Episode Two')).toBeInTheDocument()
  })

  it('shows the waiting label for a pending queued part', () => {
    setup({ status: status({ status: 'pending', isPending: true }) })

    // Visible label + the sr-only mirror for assistive tech
    expect(screen.getAllByText('downloadStatus.status_waiting')).toHaveLength(2)
  })

  it('shows the percentage instead of the label while running', () => {
    setup({
      status: status({
        status: 'running',
        isDownloading: true,
        progressEntries: [
          {
            downloadId: 'dl-1',
            stage: 'audio',
            percentage: 60,
            transferRate: 0,
            isComplete: false,
          } as PartDownloadStatus['progressEntries'][number],
          {
            downloadId: 'dl-1',
            stage: 'video',
            percentage: 30,
            transferRate: 0,
            isComplete: false,
          } as PartDownloadStatus['progressEntries'][number],
        ],
      }),
    })

    // (60 + 30 + 0) / 3 = 30; the status is only announced via sr-only
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(
      screen.getByText('downloadStatus.status_downloading', {
        selector: '.sr-only',
      }),
    ).toBeInTheDocument()
  })

  it('strikes through a cancelled part title', () => {
    setup({ status: status({ status: 'cancelled', isCancelled: true }) })

    const title = screen.getByText('Episode Two')
    expect(title).toHaveClass('line-through')
    expect(
      screen.getAllByText('downloadStatus.status_cancelled').length,
    ).toBeGreaterThan(0)
  })

  it('renders a muted title without status for a non-target part', () => {
    setup({ isQueued: false })

    expect(screen.getByText('P2')).toBeInTheDocument()
    expect(
      screen.queryByText('downloadStatus.status_waiting'),
    ).not.toBeInTheDocument()
  })

  it('opens the part in the browser when the thumbnail is clicked', async () => {
    const { user, onThumbnailClick } = setup()

    await user.click(screen.getByRole('img'))

    expect(onThumbnailClick).toHaveBeenCalledTimes(1)
  })

  it('offers open-file and reveal-folder actions on a completed row', async () => {
    // Resolve the open_file/reveal_in_folder invokes — an unresolved mock
    // returns undefined synchronously and the .catch chains surface as
    // unhandled rejections, failing the vitest run despite passing asserts.
    mockInvoke.mockResolvedValue(undefined)
    const { user } = setup({
      status: status({
        status: 'done',
        isComplete: true,
        outputPath: '/downloads/Episode Two.mp4',
      }),
    })

    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.querySelector('svg.lucide-folder-open'))
    expect(buttons).toHaveLength(2)

    await user.click(buttons[0]!)
    expect(mockInvoke).toHaveBeenCalledWith('open_file', {
      path: '/downloads/Episode Two.mp4',
    })

    await user.click(buttons[1]!)
    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_folder', {
      path: '/downloads/Episode Two.mp4',
    })
  })

  it('expands the progress detail only for the active part', async () => {
    const running = () =>
      status({ status: 'running' as const, isDownloading: true })
    const active = setup({ status: running(), isActive: true })
    // The expanded PartDownloadProgress renders its stage icons with labels
    expect(active.getByLabelText('video.stage_audio')).toBeInTheDocument()

    const inactive = setup({ status: running(), isActive: false })
    // Scoped to the inactive render's own container (both renders stay
    // mounted, so document-wide queries would see the active one)
    const inactiveQuery = within(inactive.container)
    expect(
      inactiveQuery.queryByLabelText('video.stage_audio'),
    ).not.toBeInTheDocument()
  })

  it('offers cancel on a pending queued row and dispatches on click', async () => {
    const { user, onCancel } = setup({
      status: status({ status: 'pending', isPending: true }),
    })

    // The row's only interactive control while pending-not-active
    await user.click(screen.getByRole('button'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('hides the row cancel for a running part (detail owns it)', () => {
    setup({ status: status({ status: 'running', isDownloading: true }) })

    expect(
      screen.queryByRole('button', { name: 'video.cancel_download' }),
    ).not.toBeInTheDocument()
  })
})
