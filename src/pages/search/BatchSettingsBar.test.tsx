import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { setUser } from '@/features/user/userSlice'
import { setVideo, useVideoInfo, VideoInfoProvider } from '@/features/video'
import { deselectAll, initPartInputs } from '@/features/video/model/inputSlice'
import type { Video } from '@/features/video/types'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen, within } from '@testing-library/react'
import { act } from 'react'
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

// 25 parts → 3 pages of PARTS_PER_PAGE(10), the last page short — enough
// to prove the page-scoped toggle touches only the visible slice.
const manyPartVideo: Video = {
  ...video,
  parts: Array.from({ length: 25 }, (_, i) => ({
    ...video.parts[0]!,
    part: `Part ${i + 1}`,
    defaultTitle: `Part ${i + 1}`,
    page: i + 1,
    cid: 1000 + i,
  })),
}

function seed(selected: boolean[], v: Video = video) {
  store.dispatch(setVideo(v))
  store.dispatch(
    initPartInputs(
      v.parts.map((p, i) => ({
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

/** Overwrites the beforeEach logged-out user with a logged-in one
 *  (VIP entitlement per the nav API's vipStatus flag). */
function loginAs(vipStatus = false) {
  act(() => {
    store.dispatch(
      setUser({
        code: 0,
        message: '',
        ttl: 0,
        data: {
          uname: 'u',
          isLogin: true,
          vipStatus,
          wbiImg: { imgUrl: '', subUrl: '' },
        },
        hasCookie: true,
      }),
    )
  })
}

/** Menu item whose label text matches (first match). */
function menuItem(menu: HTMLElement, text: string) {
  return within(menu).getAllByText(text)[0]!.closest('[role=menuitem]')!
}

/** Harness: the bar needs the video-info context (useVideoInfo). */
function Harness({ currentPage = 1 }: { currentPage?: number }) {
  useVideoInfo()
  return <BatchSettingsBar currentPage={currentPage} />
}

function renderBar(currentPage = 1) {
  return renderWithProviders(
    <VideoInfoProvider>
      <Harness currentPage={currentPage} />
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

  it('shows the auto target until an explicit pick, regardless of login', async () => {
    seed([true, true])
    renderBar()

    // No-pick state: the target is the auto sentinel — the trigger must
    // not claim a fixed tier, because downloads resolve per part to the
    // highest quality each account can fetch.
    expect(
      await screen.findByRole('button', { name: 'video.quality_label' }),
    ).toHaveTextContent('search.quality_auto')

    loginAs()
    expect(
      screen.getByRole('button', { name: 'video.quality_label' }),
    ).toHaveTextContent('search.quality_auto')
  })

  it('keeps the batch target when every part is deselected (and stays editable)', async () => {
    seed([true, true])
    const { user } = renderBar()

    // Pick an explicit tier so retention is distinguishable from the
    // no-pick auto state.
    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('360p'))

    // Deselect all at the store level (keeps the toolbar toggle out of
    // this assertion): the target lives in redux, so it stays shown — and
    // the trigger stays ENABLED (pre-configuring before selecting is the
    // model).
    store.dispatch(deselectAll())
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
    expect(
      screen.getByRole('button', { name: 'video.select_all' }),
    ).toBeInTheDocument()
    // The single control's label only swaps to Deselect at full selection
    // Note: role queries, not text queries: the stacked-label button keeps
    // both labels in the DOM (inactive twin aria-hidden — see
    // BatchSettingsBar.tsx), so queryByText would still match the hidden one
    expect(
      screen.queryByRole('button', { name: 'video.deselect_all' }),
    ).not.toBeInTheDocument()
  })

  it('swaps the select-all button to Deselect at full selection', () => {
    seed([true, true])
    renderBar()

    // Fully selected → the single control becomes the deselect action
    expect(
      screen.queryByRole('button', { name: 'video.select_all' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'video.deselect_all' }),
    ).toBeInTheDocument()

    // Note: act() flushes the dispatch's re-render — no user event
    // follows to flush it before the assertion
    act(() => {
      store.dispatch(deselectAll())
    })
    expect(
      screen.getByRole('button', { name: 'video.select_all' }),
    ).toBeInTheDocument()
  })

  it('toggles selection with repeated presses of the single button', async () => {
    seed([true, false])
    const { user } = renderBar()

    await user.click(screen.getByRole('button', { name: 'video.select_all' }))
    expect(store.getState().input.partInputs.every((p) => p.selected)).toBe(
      true,
    )

    // Second press on the (now Deselect-labeled) control clears it
    await user.click(screen.getByRole('button', { name: 'video.deselect_all' }))
    expect(store.getState().input.partInputs.some((p) => p.selected)).toBe(
      false,
    )
  })

  it('hides the page-scoped toggle on single-page videos', () => {
    seed([true, true])
    renderBar()

    // 2 parts = 1 page: the whole-video toggle already covers the range
    expect(
      screen.queryByRole('button', { name: 'video.select_page' }),
    ).not.toBeInTheDocument()
  })

  it('selects only the visible page via the page-scoped toggle', async () => {
    // Everything starts deselected; page 2 covers part indices 10-19
    seed(
      Array.from({ length: 25 }, () => false),
      manyPartVideo,
    )
    const { user } = renderBar(2)

    await user.click(screen.getByRole('button', { name: 'video.select_page' }))
    const selected = store.getState().input.partInputs.map((p) => p.selected)
    expect(selected.slice(10, 20).every(Boolean)).toBe(true)
    // Other pages keep their (empty) selection
    expect(selected.slice(0, 10).some(Boolean)).toBe(false)
    expect(selected.slice(20).some(Boolean)).toBe(false)
  })

  it('deselects only the visible page when the page toggle swaps to Deselect', async () => {
    // Page 2 fully selected, one stray selection on page 1
    seed(
      Array.from({ length: 25 }, (_, i) => i === 3 || (i >= 10 && i < 20)),
      manyPartVideo,
    )
    const { user } = renderBar(2)

    await user.click(
      screen.getByRole('button', { name: 'video.deselect_page' }),
    )
    const selected = store.getState().input.partInputs.map((p) => p.selected)
    expect(selected.slice(10, 20).some(Boolean)).toBe(false)
    // The page-1 selection survives the page-2 clear
    expect(selected[3]).toBe(true)
  })

  it('handles the short last page: selects exactly its remaining parts', async () => {
    // Page 3 of 3 holds only indices 20-24 (5 of PARTS_PER_PAGE)
    seed(
      Array.from({ length: 25 }, () => false),
      manyPartVideo,
    )
    const { user } = renderBar(3)

    await user.click(screen.getByRole('button', { name: 'video.select_page' }))
    const selected = store.getState().input.partInputs.map((p) => p.selected)
    expect(selected.slice(20).every(Boolean)).toBe(true)
    expect(selected.slice(0, 20).some(Boolean)).toBe(false)
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

  it('gates quality options by static account rules, not per-video availability', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })

    // Logged out: VIP tiers and the login band (1080p+/1080p60) disabled
    // with their reasons; standard tiers pickable even though no per-part
    // ladder was ever fetched (backend resolves best-effort).
    await user.click(trigger)
    let menu = await screen.findByRole('menu')
    expect(menuItem(menu, '8K')).toHaveAttribute('aria-disabled', 'true')
    expect(menuItem(menu, '1080p60')).toHaveAttribute('aria-disabled', 'true')
    expect(within(menu).getByText('1080p')).toBeEnabled()
    await user.keyboard('{Escape}')

    // Logged in without VIP: the login band opens up but the VIP tiers
    // stay gated.
    loginAs()
    await user.click(trigger)
    menu = await screen.findByRole('menu')
    expect(within(menu).getByText('1080p60')).toBeEnabled()
    expect(menuItem(menu, '8K')).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Escape}')

    // VIP (nav vipStatus = 1): every tier including 8K opens up.
    loginAs(true)
    await user.click(trigger)
    menu = await screen.findByRole('menu')
    expect(menuItem(menu, '8K')).not.toHaveAttribute('aria-disabled')
    await user.keyboard('{Escape}')
  })

  it('gates Hi-Res Lossless behind VIP and enables it for VIP accounts', async () => {
    seed([true, true])
    const { user } = renderBar()
    const trigger = await screen.findByRole('button', {
      name: 'video.audio_quality_label',
    })

    // Logged in without VIP: audio has no login band — the only gate is
    // the VIP entitlement, so Hi-Res/Dolby stay disabled.
    loginAs()
    await user.click(trigger)
    let menu = await screen.findByRole('menu')
    expect(menuItem(menu, 'Hi-Res Lossless')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(menuItem(menu, 'Dolby Atmos')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.keyboard('{Escape}')

    // VIP (nav vipStatus = 1): the lossless tiers open up.
    loginAs(true)
    await user.click(trigger)
    menu = await screen.findByRole('menu')
    expect(menuItem(menu, 'Hi-Res Lossless')).not.toHaveAttribute(
      'aria-disabled',
    )
    await user.keyboard('{Escape}')
  })

  it('re-clears the batch target back to auto via the sentinel option', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.quality_label',
    })
    await user.click(trigger)
    let menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('1080p'))
    expect(store.getState().input.batchSettings.videoQuality).toBe('80')

    // Picking the auto sentinel clears the stored target: parts without
    // an explicit choice go back to per-part best resolution.
    await user.click(trigger)
    menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('search.quality_auto'))
    expect(store.getState().input.batchSettings.videoQuality).toBeNull()
  })

  it('shows the auto audio target and re-clears it via the sentinel', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.audio_quality_label',
    })
    expect(trigger).toHaveTextContent('search.quality_auto')

    await user.click(trigger)
    let menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('192K'))
    expect(store.getState().input.batchSettings.audioQuality).toBe('30280')
    expect(trigger).toHaveTextContent('192K')

    // The sentinel clears the stored audio target the same way as video:
    // parts go back to per-part best resolution.
    await user.click(trigger)
    menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('search.quality_auto'))
    expect(store.getState().input.batchSettings.audioQuality).toBeNull()
    expect(
      screen.getByRole('button', { name: 'video.audio_quality_label' }),
    ).toHaveTextContent('search.quality_auto')
  })

  it('applies subtitle mode changes and shows the language list', async () => {
    seed([true, true])
    const { user } = renderBar()

    // Open the compound subtitle menu. Mode items keep the menu open
    // (the display switches check icon ↔ 優先度 N in place).
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
    // Soft with no picks seeds the all-languages wildcard.
    expect(state.batchSettings.subtitle?.selectedLans).toEqual(['*'])
    // Parts are untouched — the enqueue resolves their configs.
    expect(state.partInputs[0]!.subtitle.mode).toBe('off')
    expect(state.partInputs[1]!.subtitle.mode).toBe('off')

    await user.keyboard('{Escape}')
  })

  it('shows the settings default subtitle mode before any batch pick', async () => {
    seed([true, true])
    store.dispatch(
      setSettings({
        defaultSubtitleMode: 'hard',
        defaultSubtitleHardLans: ['ja', 'zh-Hans', '*'],
      }),
    )
    const { user } = renderBar()

    // Display-only fallback: the trigger mirrors the settings default
    // (mode + priority list) while the store target stays null.
    const trigger = await screen.findByRole('button', {
      name: 'video.subtitle',
    })
    expect(trigger).toHaveTextContent('video.subtitle_hard')
    expect(trigger).toHaveTextContent('日本語')
    expect(store.getState().input.batchSettings.subtitle).toBeNull()

    // An explicit pick replaces the display and lands in the store.
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('video.subtitle_off'))
    expect(trigger).toHaveTextContent('video.subtitle_off')
    expect(store.getState().input.batchSettings.subtitle).toEqual({
      mode: 'off',
      selectedLans: [],
    })
    await user.keyboard('{Escape}')

    // Reset: later tests share the singleton store.
    store.dispatch(
      setSettings({ defaultSubtitleMode: 'off', defaultSubtitleHardLans: [] }),
    )
  })

  it('seeds the full hard list when re-picking hard under the settings-hard fallback', async () => {
    seed([true, true])
    store.dispatch(
      setSettings({
        defaultSubtitleMode: 'hard',
        defaultSubtitleHardLans: ['ja', 'zh-Hans', '*'],
      }),
    )
    const { user } = renderBar()

    // No stored pick: clicking the (already displayed) hard mode item
    // must seed the full priority list WITH the wildcard tail — the
    // display fallback must not be mistaken for explicit picks.
    const trigger = await screen.findByRole('button', {
      name: 'video.subtitle',
    })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByText('video.subtitle_hard'))

    expect(store.getState().input.batchSettings.subtitle).toEqual({
      mode: 'hard',
      selectedLans: ['ja', 'zh-Hans', '*'],
    })
    await user.keyboard('{Escape}')

    store.dispatch(
      setSettings({ defaultSubtitleMode: 'off', defaultSubtitleHardLans: [] }),
    )
  })

  it('shows the soft settings default as the all-languages pick', async () => {
    seed([true, true])
    store.dispatch(setSettings({ defaultSubtitleMode: 'soft' }))
    renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.subtitle',
    })
    expect(trigger).toHaveTextContent('video.subtitle_soft')
    expect(trigger).toHaveTextContent('search.subtitle_all_langs')
    expect(store.getState().input.batchSettings.subtitle).toBeNull()

    store.dispatch(setSettings({ defaultSubtitleMode: 'off' }))
  })

  it('resets soft to all languages when switching from hard', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.subtitle',
    })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')

    // Hard seeds the settings priority list, then soft resets to the
    // embed-all set instead of carrying the priority list over.
    await user.click(within(menu).getByText('video.subtitle_hard'))
    expect(store.getState().input.batchSettings.subtitle).toEqual({
      mode: 'hard',
      selectedLans: ['zh-Hans', '*'],
    })
    await user.click(within(menu).getByText('video.subtitle_soft'))

    expect(store.getState().input.batchSettings.subtitle).toEqual({
      mode: 'soft',
      selectedLans: ['*'],
    })
    await user.keyboard('{Escape}')
  })

  it('does not carry off-state pending picks into soft', async () => {
    seed([true, true])
    const { user } = renderBar()

    const trigger = await screen.findByRole('button', {
      name: 'video.subtitle',
    })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')

    // Pre-picking a language while off only stores a pending selection;
    // soft still starts from the embed-all set.
    await user.click(within(menu).getByText('日本語'))
    await user.click(within(menu).getByText('video.subtitle_soft'))

    expect(store.getState().input.batchSettings.subtitle).toEqual({
      mode: 'soft',
      selectedLans: ['*'],
    })
    await user.keyboard('{Escape}')
  })
  it('toggles whole-video selection with Ctrl+A', () => {
    seed([true, false])
    renderBar()

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    expect(store.getState().input.partInputs.every((p) => p.selected)).toBe(
      true,
    )
    // All selected → the same chord deselects, and the chord stays
    // claimed (native page select-all suppressed)
    // Note: dispatched by hand because fireEvent returns no event handle;
    // asserting defaultPrevented needs a reference to the event
    const claimed = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(claimed)
    expect(store.getState().input.partInputs.some((p) => p.selected)).toBe(
      false,
    )
    expect(claimed.defaultPrevented).toBe(true)
  })

  it('keeps native select-all when a text field is focused', () => {
    seed([false, false])
    renderBar()

    // Dispatch on an input: bubbles to window but must pass through
    // untouched (the guard checks the event target)
    const field = document.createElement('input')
    document.body.appendChild(field)
    fireEvent.keyDown(field, { key: 'a', ctrlKey: true })

    expect(store.getState().input.partInputs.some((p) => p.selected)).toBe(
      false,
    )
  })
})

it('offers all-languages in soft mode only and drops it when switching to hard', async () => {
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  // Soft seeds the all-languages sentinel automatically.
  await user.click(within(menu).getByText('video.subtitle_soft'))
  expect(trigger).toHaveTextContent('search.subtitle_all_langs')
  expect(store.getState().input.batchSettings.subtitle?.selectedLans).toEqual([
    '*',
  ])

  // Switching to hard seeds the settings priority list: the soft-only
  // wildcard toggle is gone, but the seeded default keeps the
  // all-languages fallback entry.
  await user.click(within(menu).getByText('video.subtitle_hard'))
  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'hard',
    selectedLans: ['zh-Hans', '*'],
  })

  // The all-languages toggle item itself is gone from the menu.
  await user.keyboard('{Escape}')
  expect(within(menu).queryByText('search.subtitle_all_langs')).toBeNull()
})

it('seeds hard mode from the settings priority list', async () => {
  store.dispatch(setSettings({ defaultSubtitleHardLans: ['ja', 'en'] }))
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  await user.click(within(menu).getByText('video.subtitle_hard'))

  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'hard',
    selectedLans: ['ja', 'en'],
  })
  await user.keyboard('{Escape}')

  // Why reset: the singleton store would leak the custom list.
  store.dispatch(setSettings({ defaultSubtitleHardLans: undefined }))
})

it('inserts a hard-mode language before the wildcard fallback', async () => {
  store.dispatch(
    setSettings({ defaultSubtitleHardLans: ['ja', 'zh-Hans', '*'] }),
  )
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  await user.click(within(menu).getByText('video.subtitle_hard'))
  await user.click(within(menu).getByText('English'))

  // English takes the next priority slot; the fallback stays last.
  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'hard',
    selectedLans: ['ja', 'zh-Hans', 'en', '*'],
  })
  await user.keyboard('{Escape}')

  store.dispatch(setSettings({ defaultSubtitleHardLans: undefined }))
})

it('appends a hard-mode language when no wildcard entry exists', async () => {
  store.dispatch(setSettings({ defaultSubtitleHardLans: ['ja'] }))
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  await user.click(within(menu).getByText('video.subtitle_hard'))
  await user.click(within(menu).getByText('English'))

  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'hard',
    selectedLans: ['ja', 'en'],
  })
  await user.keyboard('{Escape}')

  store.dispatch(setSettings({ defaultSubtitleHardLans: undefined }))
})

it('keeps explicit off-state picks when switching to hard', async () => {
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  await user.click(within(menu).getByText('日本語'))
  await user.click(within(menu).getByText('video.subtitle_hard'))

  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'hard',
    selectedLans: ['ja'],
  })
  await user.keyboard('{Escape}')
})

it('clears the selection when switching off', async () => {
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  await user.click(within(menu).getByText('video.subtitle_soft'))
  await user.click(within(menu).getByText('video.subtitle_off'))

  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'off',
    selectedLans: [],
  })
  await user.keyboard('{Escape}')
})

it('replaces the soft wildcard with a specific language and toggles it back', async () => {
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  await user.click(within(menu).getByText('video.subtitle_soft'))
  // Specific pick replaces the "everything" sentinel...
  await user.click(within(menu).getByText('日本語'))
  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'soft',
    selectedLans: ['ja'],
  })

  // ...the sentinel item restores it...
  await user.click(within(menu).getByText('search.subtitle_all_langs'))
  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'soft',
    selectedLans: ['*'],
  })

  // ...and it toggles off again.
  await user.click(within(menu).getByText('search.subtitle_all_langs'))
  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'soft',
    selectedLans: [],
  })
  await user.keyboard('{Escape}')
})

it('removes a language from the hard priority list', async () => {
  seed([true, true])
  const { user } = renderBar()

  const trigger = await screen.findByRole('button', { name: 'video.subtitle' })
  await user.click(trigger)
  const menu = await screen.findByRole('menu')

  await user.click(within(menu).getByText('video.subtitle_hard'))
  // Seeded default: 中文(简体) first; uncheck leaves the fallback only.
  await user.click(within(menu).getByText('中文(简体)'))
  expect(store.getState().input.batchSettings.subtitle).toEqual({
    mode: 'hard',
    selectedLans: ['*'],
  })
  await user.keyboard('{Escape}')
})
