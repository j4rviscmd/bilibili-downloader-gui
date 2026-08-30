/**
 * PartStatusRow suite.
 *
 * Drives the row through each status shape: stage bars with speeds, merge
 * and subtitle stages, cancel affordance rules, cancelled strikethrough,
 * and error-title mapping (known ERR:: code vs raw fallback).
 */

import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PartStatusRowModel } from '../model/types'
import { PartStatusRow } from './PartStatusRow'

const onCancel = vi.fn()

function rowOf(overrides: Partial<PartStatusRowModel>): PartStatusRowModel {
  return {
    downloadId: 'parent-1-p1',
    partIndex: 1,
    title: 'Part title',
    status: 'pending',
    percentage: 0,
    audio: null,
    video: null,
    merge: null,
    isRetrying: false,
    stage: 'download',
    isComplete: false,
    ...overrides,
  }
}

function renderRow(part: PartStatusRowModel, cancel = onCancel) {
  return renderWithProviders(
    <TooltipProvider>
      <PartStatusRow part={part} onCancel={cancel} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PartStatusRow stages', () => {
  it('shows audio and video stage percentages and formatted speeds while downloading', () => {
    renderRow(
      rowOf({
        status: 'running',
        audio: { percentage: 40, transferRate: 500 },
        video: { percentage: 99.6, transferRate: 2048 },
      }),
    )

    // Math.min(100, Math.round(...)) clamps 99.6 to 100.
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    // formatTransferRate: <1000 -> KB/s, >=1000 -> MB/s.
    expect(screen.getByText('500KB/s')).toBeInTheDocument()
    expect(screen.getByText('2.0MB/s')).toBeInTheDocument()
  })

  it('renders nothing for stages without progress data', () => {
    renderRow(
      rowOf({
        status: 'running',
        audio: null,
        video: null,
      }),
    )

    // Only the audio/video emoji labels are absent: no percentage nodes.
    expect(screen.queryByText(/\d+%/)).toBeNull()
  })

  it('appends the indeterminate subtitle indicator during the subtitle stage', () => {
    const { container } = renderRow(
      rowOf({
        status: 'running',
        stage: 'subtitle',
        audio: { percentage: 100, transferRate: 0 },
        video: { percentage: 100, transferRate: 0 },
      }),
    )

    expect(container.textContent).toContain('💬')
    expect(container.textContent).toContain('100%')
  })

  it('shows the merge bar with its percentage during the merge stage', () => {
    renderRow(
      rowOf({
        status: 'running',
        stage: 'merge',
        merge: { percentage: 45, transferRate: 0 },
        audio: { percentage: 100, transferRate: 0 },
        video: { percentage: 100, transferRate: 0 },
      }),
    )

    expect(screen.getByText('45%')).toBeInTheDocument()
  })
})

describe('PartStatusRow cancel affordance', () => {
  it('renders the cancel button and reports the click for a pending part', async () => {
    const { user } = renderRow(rowOf({ status: 'pending' }))

    await user.click(screen.getByRole('button'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('hides cancel for a done part', () => {
    renderRow(rowOf({ status: 'done', isComplete: true }))

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('hides cancel while merging', () => {
    renderRow(
      rowOf({
        status: 'running',
        stage: 'merge',
        merge: { percentage: 10, transferRate: 0 },
      }),
    )

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('hides cancel for a completed-but-running part', () => {
    renderRow(rowOf({ status: 'running', isComplete: true, stage: 'download' }))

    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PartStatusRow titles', () => {
  it('greys out and strikes through a cancelled part', () => {
    renderRow(rowOf({ status: 'cancelled', title: 'Skipped part' }))

    const title = screen.getByText('Skipped part')
    expect(title.className).toContain('line-through')
    expect(title.className).toContain('text-muted-foreground')
  })

  it('shows the mapped translation key for a known backend error', () => {
    renderRow(
      rowOf({
        status: 'error',
        title: 'Part title',
        errorMessage: 'x ERR::VIDEO_NOT_FOUND y',
      }),
    )

    expect(screen.getByText('video.video_not_found')).toBeInTheDocument()
  })

  it('falls back to the part title for an unknown error code', () => {
    renderRow(
      rowOf({ status: 'error', title: 'Part title', errorMessage: 'mystery' }),
    )

    expect(screen.getByText('Part title')).toBeInTheDocument()
  })

  it('truncates the tooltip copy for titles over 100 characters', async () => {
    const long = 'a'.repeat(120)
    const { user } = renderRow(rowOf({ status: 'done', title: long }))

    // The visible title stays untruncated in the DOM (CSS clips it); the
    // tooltip opened by hovering carries the 100-char + ellipsis copy.
    expect(screen.getByText(long)).toBeInTheDocument()
    await user.hover(screen.getByText(long))
    // Radix re-renders portal content; several ancestors carry the same text
    // (FavoriteItem.test uses the same findAllByText pattern).
    const truncated = await screen.findAllByText('a'.repeat(100) + '…')
    expect(truncated.length).toBeGreaterThan(0)
  })

  it('renders the P index of the part', () => {
    renderRow(rowOf({ partIndex: 7 }))

    expect(screen.getByText('P7')).toBeInTheDocument()
  })
})
