import { store } from '@/app/store'
import { setUser } from '@/features/user/userSlice'
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
  return <BatchSettingsBar />
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
    store.dispatch(
      setUser({
        code: 0,
        message: '',
        ttl: 0,
        data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
        hasCookie: false,
      }),
    )
  })

  it('defaults the quality targets to the best tier of the login state, not per-part data', async () => {
    seed([true, true])
    renderBar()

    // Anonymous → platform cap is 480p, even though the selected parts'
    // ladders (fetched sample) top out at 1080p+/1080p60.
    expect(
      await screen.findByRole('button', { name: 'video.quality_label' }),
    ).toHaveTextContent('480p')

    // Logged in → the standard top tier (1080p). Enhanced tiers (1080p+/
    // 1080p60) are explicit picks: videos without them would leave the
    // trigger pointing at an option the list marks unavailable.
    store.dispatch(
      setUser({
        code: 0,
        message: '',
        ttl: 0,
        data: { uname: 'u', isLogin: true, wbiImg: { imgUrl: '', subUrl: '' } },
        hasCookie: true,
      }),
    )
    expect(
      await screen.findByRole('button', { name: 'video.quality_label' }),
    ).toHaveTextContent('1080p')
  })

  it('keeps the batch target when every part is deselected (and stays editable)', async () => {
    seed([true, true])
    const { user } = renderBar()

    // Pick a value that is not the login-state default so the retention is
    // distinguishable (the anonymous default is 480p).
    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('360p'))

    // Deselect all: the target lives in redux, so it stays shown — and the
    // trigger stays ENABLED (pre-configuring before selecting is the model).
    await user.click(screen.getByText('video.deselect_all'))
    const qualityTrigger = screen.getByRole('button', {
      name: 'video.quality_label',
    })
    expect(qualityTrigger).toHaveTextContent('360p')
    expect(qualityTrigger).toBeEnabled()
  })

  it('renders with the summary and page controls when nothing is selected', () => {
    seed([false, false])
    renderBar()
    expect(screen.getByText('search.batch_title')).toBeInTheDocument()
    expect(screen.getByText(/search\.batch_applies/)).toBeInTheDocument()
    expect(screen.getByText('video.select_all')).toBeInTheDocument()
  })

  it('stores a batch quality target without touching parts', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('1080p'))

    // The batch target lands in redux; with the eager fetch gone, parts
    // stay empty until their own panel opens (enqueue resolves
    // explicit-part > batch > best-effort default).
    const state = store.getState().input
    expect(state.batchSettings.videoQuality).toBe('80')
    expect(state.partInputs[0]!.videoQuality).toBe('')
    expect(state.partInputs[0]!.videoQualityExplicit).toBeFalsy()
    expect(state.partInputs[1]!.videoQuality).toBe('')
  })

  it('allows setting a batch target with zero parts selected', async () => {
    seed([false, false])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })
    expect(trigger).toBeEnabled()
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('1080p'))

    expect(store.getState().input.batchSettings.videoQuality).toBe('80')
  })

  it('gates quality options by static login-state rules, not per-video availability', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')

    // VIP tiers disabled with their reason; standard tiers pickable even
    // though no per-part ladder was ever fetched (backend resolves
    // best-effort).
    const vip = within(menu).getAllByText('8K')[0]!.closest('[role=menuitem]')!
    expect(vip).toHaveAttribute('aria-disabled', 'true')
    expect(within(menu).getByText('1080p')).toBeEnabled()
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
    expect(state.batchSettings.subtitle?.mode).toBe('soft')
    // Parts are untouched — the enqueue resolves their configs.
    expect(state.partInputs[0]!.subtitle.mode).toBe('off')
    expect(state.partInputs[1]!.subtitle.mode).toBe('off')

    await user.keyboard('{Escape}')
  })
})

it('offers all-languages in soft mode only and drops it when switching to hard', async () => {
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  // Soft + all-languages: the sentinel applies.
  await user.click(within(menu).getByText('video.subtitle_soft'))
  await user.click(within(menu).getByText('search.subtitle_all_langs'))
  expect(trigger).toHaveTextContent('search.subtitle_all_langs')

  // Switching to hard drops the wildcard...
  await user.click(within(menu).getByText('video.subtitle_hard'))
  expect(trigger).not.toHaveTextContent('search.subtitle_all_langs')

  // ...and the item itself is gone from the menu.
  await user.keyboard('{Escape}')
  expect(within(menu).queryByText('search.subtitle_all_langs')).toBeNull()
})
