import { store } from '@/app/store'
import { setVideo, useVideoInfo, VideoInfoProvider } from '@/features/video'
import { initPartInputs } from '@/features/video/model/inputSlice'
import type { Video } from '@/features/video/types'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchSettingsBar from './BatchSettingsBar'

// Qualities fetch (lazy-load on selection): P2 tops out at 720p60 — the
// batch union must contain 1080p+ / 1080p60 via P1 only.
const QUALITIES_BY_CID: Record<
  number,
  { vq: number[]; aq: number[]; subs: string[] }
> = {
  101: {
    vq: [116, 112, 80, 74, 64, 32, 16],
    aq: [30280, 30232, 30216],
    subs: ['ja', 'zh-Hans'],
  },
  102: { vq: [74, 64, 32, 16], aq: [30280, 30232, 30216], subs: ['zh-Hans'] },
}

const video: Video = {
  title: 'Test video',
  bvid: 'BV1test',
  parts: [101, 102].map((cid, i) => ({
    part: `Part ${i + 1}`,
    defaultTitle: `Part ${i + 1}`,
    page: i + 1,
    cid,
    duration: 60,
    videoQualities: [],
    audioQualities: [],
    thumbnail: { url: '' },
    subtitles: [],
  })),
  isLimitedQuality: false,
  contentType: 'video',
}

function seed(selected: boolean[]) {
  store.dispatch(setVideo(video))
  store.dispatch(
    initPartInputs(
      video.parts.map((p, i) => ({
        cid: p.cid,
        page: p.page,
        title: p.part,
        videoQuality: '',
        audioQuality: '',
        selected: selected[i]!,
        duration: p.duration,
      })),
    ),
  )
}

/** Harness: the bar needs the video-info context (useVideoInfo). */
function Harness() {
  useVideoInfo()
  return <BatchSettingsBar pageRange={{ startIndex: 0, endIndex: 1 }} />
}

function renderBar() {
  return renderWithProviders(
    <VideoInfoProvider>
      <Harness />
    </VideoInfoProvider>,
    { route: '/search' },
  )
}

describe('BatchSettingsBar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      const a = args as { cid?: number }
      if (cmd === 'fetch_part_qualities') {
        const q = QUALITIES_BY_CID[a.cid!]!
        return [
          q.vq.map((id) => ({ id, quality: `q${id}` })),
          q.aq.map((id) => ({ id, quality: `a${id}` })),
        ]
      }
      if (cmd === 'fetch_subtitles_for_part') {
        return QUALITIES_BY_CID[a.cid!]!.subs.map((lan) => ({
          lan,
          lanDoc: lan,
          subtitleUrl: '',
          isAi: false,
        }))
      }
      return []
    })
  })

  it('renders with the summary and page controls when nothing is selected', () => {
    seed([false, false])
    renderBar()
    expect(screen.getByText('search.batch_title')).toBeInTheDocument()
    expect(screen.getByText(/search\.batch_applies/)).toBeInTheDocument()
    expect(screen.getByText('video.select_all_page')).toBeInTheDocument()
  })

  it('applies a batch quality target to all selected parts', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })
    await user.click(trigger)
    const item = await screen.findByText('1080p')
    await user.click(item)

    const state = store.getState().input
    expect(state.partInputs[0]!.videoQuality).toBe('80')
    expect(state.partInputs[1]!.videoQuality).toBe('80')
  })

  it('unions per-part availability in the quality options', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })
    await user.click(trigger)
    // Full ladder renders: P1-only tiers (1080p+ / 1080p60) and shared
    // tiers both appear. The trigger value also matches one of them.
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByText('1080p60')
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(within(menu).getByText('1080p+')).toBeInTheDocument()
    expect(within(menu).getByText('720p60')).toBeInTheDocument()
    expect(within(menu).getByText('8K')).toBeInTheDocument()
    await user.keyboard('{Escape}')
  })

  it('applies subtitle mode changes and shows the language list', async () => {
    seed([true, true])
    const { user } = renderBar()

    // Open the compound subtitle menu. Mode items keep the menu open
    // (the display switches ✓ ↔ 優先度 N in place).
    const subtitleTrigger = await screen.findByRole('button', {
      name: 'video.subtitle',
    })
    await user.click(subtitleTrigger)

    // Switch to soft mode — languages from the FIXED list render in the
    // menu; available ones (ja, zh-Hans) are enabled, the rest disabled.
    await user.click(await screen.findByText('video.subtitle_soft'))
    expect(await screen.findByText('日本語')).toBeInTheDocument()
    expect(screen.getByText('中文(简体)')).toBeInTheDocument()
    expect(screen.getByText('한국어')).toBeInTheDocument()
    expect(screen.getByText('ไทย')).toBeInTheDocument()

    const state = store.getState().input
    expect(state.partInputs[0]!.subtitle.mode).toBe('soft')
    expect(state.partInputs[1]!.subtitle.mode).toBe('soft')

    await user.keyboard('{Escape}')
  })
})
