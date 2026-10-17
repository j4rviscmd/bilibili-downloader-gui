import { store } from '@/app/store'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { useVideoInfo } from '@/features/video'
import {
  fetchBangumiPartQualities,
  fetchPartQualities,
  fetchSubtitlesForPart,
} from '@/features/video/api/fetchVideoInfo'
import {
  usePartDownloadStatus,
  type PartQueueStatus,
} from '@/features/video/hooks/usePartDownloadStatus'
import { setInput } from '@/features/video/model/inputSlice'
import type { Input, PartInput, Video } from '@/features/video/types'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { renderWithProviders, resetQueue, seedSession } from '@/test/test-utils'
import { fireEvent, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VideoPartCard from './VideoPartCard'

// The orchestrating context hook and the status hook are covered by their
// own tests; mock at the hook level so this suite drives the card directly.
vi.mock('@/features/video', () => ({
  useVideoInfo: vi.fn(),
}))
vi.mock('@/features/video/hooks/usePartDownloadStatus', () => ({
  usePartDownloadStatus: vi.fn(),
}))
vi.mock('@/features/video/api/fetchVideoInfo', () => ({
  fetchPartQualities: vi.fn(),
  fetchBangumiPartQualities: vi.fn(),
  fetchSubtitlesForPart: vi.fn(),
}))
/** Minimal single-part video the card is rendered against. */
const video: Video = {
  title: 'My Video',
  bvid: 'BV1xx411c7XD',
  contentType: 'video',
  isLimitedQuality: false,
  parts: [
    {
      part: 'Part 1',
      defaultTitle: 'My Video Part 1',
      page: 1,
      cid: 111,
      duration: 125,
      videoQualities: [],
      audioQualities: [],
      thumbnail: { url: '' },
      subtitles: [],
    },
  ],
}

/** Idle queue-only status the mocked hook returns by default. */
function createMockStatus(
  overrides: Partial<PartQueueStatus> = {},
): PartQueueStatus {
  return {
    downloadId: undefined,
    status: undefined,
    errorMessage: undefined,
    outputPath: undefined,
    filename: undefined,
    isPending: false,
    isDownloading: false,
    hasError: false,
    isCancelling: false,
    isCancelled: false,
    isDone: false,
    ...overrides,
  }
}

/** Builds a selected PartInput for page 1. */
function createPartInput(overrides: Partial<PartInput> = {}): PartInput {
  return {
    cid: 111,
    page: 1,
    title: 'My Video Part 1',
    videoQuality: '',
    audioQuality: '',
    selected: true,
    duration: 125,
    subtitle: { mode: 'off', selectedLans: [] },
    ...overrides,
  }
}

/** Full User payload for driving the user-slice login state in tests. */
function userState(isLogin: boolean): User {
  return {
    code: 0,
    message: '',
    ttl: 0,
    data: { uname: 'u', isLogin, wbiImg: { imgUrl: '', subUrl: '' } },
    hasCookie: isLogin,
  }
}

/** Builds the useVideoInfo value the card consumes. */
function createMockVideoInfo(
  overrides: Partial<ReturnType<typeof useVideoInfo>> = {},
): ReturnType<typeof useVideoInfo> {
  return {
    onValid2: vi.fn(),
    onValid1: vi.fn(),
    download: vi.fn(),
    videoId: 'BV1xx411c7XD',
    isForm1Valid: true,
    isForm2ValidAll: true,
    duplicateIndices: [],
    selectedCount: 1,
    isFetching: false,
    input: {} as Input,
    progress: [],
    video,
    ...overrides,
  } as ReturnType<typeof useVideoInfo>
}

type SetupOptions = {
  partInput?: Partial<PartInput>
  status?: Partial<PartQueueStatus>
  isDuplicate?: boolean
  /** Overrides the default single-part video fixture. */
  video?: Video
  /** onValid2 spy installed into the mocked useVideoInfo value. */
  onValid2?: Mock
  /** Preview-dialog opener passed down to the card (page-owned). */
  onThumbnailClick?: () => void
}

/** Seeds the input slice plus both mocked hooks, then renders the card. */
function setup({
  partInput = {},
  status = {},
  isDuplicate,
  video: videoFixture,
  onValid2,
  onThumbnailClick = vi.fn(),
}: SetupOptions = {}) {
  store.dispatch(
    setInput({
      url: '',
      partInputs: [createPartInput(partInput)],
      pendingDownload: null,
      batchSettings: { videoQuality: null, audioQuality: null, subtitle: null },
      homePage: 1,
    } satisfies Input),
  )
  vi.mocked(useVideoInfo).mockReturnValue(
    createMockVideoInfo(onValid2 ? { onValid2 } : {}),
  )
  vi.mocked(usePartDownloadStatus).mockReturnValue(createMockStatus(status))
  return renderWithProviders(
    // The app wraps cards in a global TooltipProvider; the card's bare
    // Tooltips (reset button, preview badge) rely on it and would throw bare.
    <TooltipProvider>
      <VideoPartCard
        video={videoFixture ?? video}
        page={1}
        isDuplicate={isDuplicate}
        onThumbnailClick={onThumbnailClick}
      />
    </TooltipProvider>,
  )
}

// --- Video fixtures for the extended tests below -----------------------------

/** Single part with a thumbnail URL (125s duration). */
const thumbVideo: Video = {
  ...video,
  parts: [
    {
      ...video.parts[0]!,
      thumbnail: { url: 'https://img.example/t.jpg' },
    },
  ],
}

/** Part under a minute long (minute field zero-pads to 0:42). */
const shortVideo: Video = {
  ...video,
  parts: [{ ...video.parts[0]!, duration: 42 }],
}

/** Single part whose name equals the video title. */
const sameTitleVideo: Video = {
  ...video,
  parts: [{ ...video.parts[0]!, part: 'My Video', defaultTitle: 'My Video' }],
}

/** Bangumi episode with an epId (qualities load per-episode). */
const bangumiVideo: Video = {
  ...video,
  contentType: 'bangumi',
  parts: [{ ...video.parts[0]!, epId: 3051843 }],
}

/** VIP-only bangumi (no epId): no qualities can be fetched. */
const vipOnlyBangumiVideo: Video = {
  ...video,
  contentType: 'bangumi',
}

/** Bangumi episode whose dash manifest is unavailable (status != 13). */
const noDashBangumiVideo: Video = {
  ...video,
  contentType: 'bangumi',
  parts: [{ ...video.parts[0]!, status: 2 }],
}

/** VIP-only bangumi episode (status 13). */
const vipStatusBangumiVideo: Video = {
  ...video,
  contentType: 'bangumi',
  parts: [{ ...video.parts[0]!, status: 13 }],
}

describe('VideoPartCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueue()
  })

  it('renders the page badge, default title and duration overlay', () => {
    setup()

    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('My Video Part 1')).toBeInTheDocument()
    // 125s renders as an m:ss badge on the thumbnail
    expect(screen.getByText('2:05')).toBeInTheDocument()
    // The copy affordance left with the part-name row (replaced by reset)
    expect(
      screen.queryByRole('button', { name: 'video.copy_title' }),
    ).not.toBeInTheDocument()
  })

  it('unchecks the part selection in the store', async () => {
    const { user: actor } = setup()
    expect(store.getState().input.partInputs[0]!.selected).toBe(true)

    await actor.click(screen.getByRole('checkbox'))

    expect(store.getState().input.partInputs[0]!.selected).toBe(false)
  })

  it('shows the duplicate-title warning only for selected parts', () => {
    setup({ isDuplicate: true })
    expect(
      screen.getByText('validation.video.title.duplicate'),
    ).toBeInTheDocument()

    setup({ partInput: { selected: false }, isDuplicate: true })
    expect(
      screen.queryByText('validation.video.title.duplicate'),
    ).not.toBeInTheDocument()
  })

  it('renders quality options with availability from the store when open', () => {
    setup({
      partInput: {
        accordionOpen: true,
        videoQualities: [{ id: 80, quality: '1080p' }],
        audioQualities: [],
        subtitles: [],
      },
    })

    // 1080p is available; 4K (id 120) is not in the store list
    expect(screen.getByRole('radio', { name: '1080p' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: '4K' })).toBeDisabled()

    // No audio qualities -> embedded-audio info box instead of a radio group
    expect(screen.getByText('video.bangumi_audio_embedded')).toBeInTheDocument()
  })

  it('shows the auto-adjust pill when the selected quality is unavailable', () => {
    // Batch-target scenario: videoQuality=1080p but this part tops out at
    // 720p60 — the download will resolve below the selection.
    setup({
      partInput: {
        videoQuality: '80',
        videoQualities: [{ id: 74, quality: '720p60' }],
        audioQualities: [],
        subtitles: [],
      },
    })

    expect(screen.getByText('video.quality_auto_adjusted')).toBeInTheDocument()
  })

  it('hides the auto-adjust pill while qualities are unfetched', () => {
    setup({ partInput: { videoQuality: '80' } })
    expect(
      screen.queryByText('video.quality_auto_adjusted'),
    ).not.toBeInTheDocument()
  })

  it('keeps all inputs editable while the part is queued or downloading', () => {
    // Replace semantics (verification decision): the enqueued payload is a
    // snapshot, so edits are safe — the user changes quality and presses
    // Download again to swap the queued part. Locking the form (and the
    // options expander inside it) blocked exactly that workflow.
    setup({
      status: { downloadId: 'dl-1', isDownloading: true, status: 'running' },
    })

    expect(screen.getByRole('checkbox')).toBeEnabled()
    expect(screen.getByDisplayValue('My Video Part 1')).toBeEnabled()
  })

  it('shows the waiting badge once the part is enqueued (no progress detail)', () => {
    // The card carries only the status badge — stage detail and
    // cancellation live on /downloads (issue #691 responsibility split).
    setup({
      status: { downloadId: 'dl-1', isPending: true, status: 'pending' },
    })

    const badge = screen.getByText('downloadStatus.status_waiting')
    expect(badge.closest('[data-status]')).toHaveAttribute(
      'data-status',
      'pending',
    )
    expect(screen.queryByText('video.download_pending')).not.toBeInTheDocument()
  })

  it('deselects the part exactly when the download completes', () => {
    const { rerender } = setup()

    // Simulate the not-done -> done status transition on rerender.
    // rerender drops the providers applied by renderWithProviders, so wrap.
    vi.mocked(usePartDownloadStatus).mockReturnValue(
      createMockStatus({ downloadId: 'dl-1', status: 'done', isDone: true }),
    )
    rerender(
      <Provider store={store}>
        <MemoryRouter>
          <TooltipProvider>
            <VideoPartCard video={video} page={1} onThumbnailClick={() => {}} />
          </TooltipProvider>
        </MemoryRouter>
      </Provider>,
    )

    expect(store.getState().input.partInputs[0]!.selected).toBe(false)
  })

  it('dispatches subtitle config changes to the store', async () => {
    const { user: actor } = setup({
      partInput: {
        accordionOpen: true,
        videoQualities: [{ id: 80, quality: '1080p' }],
        audioQualities: [],
        subtitles: [
          {
            lan: 'zh',
            lanDoc: 'Chinese',
            subtitleUrl: 'https://s.bcc',
            isAi: false,
          },
        ],
      },
    })

    await actor.click(
      screen.getByRole('radio', { name: 'video.subtitle_soft' }),
    )

    expect(store.getState().input.partInputs[0]!.subtitle).toEqual({
      mode: 'soft',
      selectedLans: ['zh'],
    })
  })

  // --- Thumbnail ------------------------------------------------------------

  it('renders the thumbnail and reports play-overlay clicks to the page', async () => {
    const onThumbnailClick = vi.fn()
    const { user } = setup({ video: thumbVideo, onThumbnailClick })

    // The hover-revealed overlay button is the sole trigger.
    await user.click(
      screen.getByRole('button', { name: 'videoSearch.previewPlay' }),
    )

    expect(onThumbnailClick).toHaveBeenCalledTimes(1)
  })

  // --- Duration badge / title reset ------------------------------------------

  it('zero-pads the seconds field for parts shorter than a minute', () => {
    setup({ video: shortVideo })

    expect(screen.getByText('0:42')).toBeInTheDocument()
  })

  it('renders the duration overlay on the thumbnail image branch too', () => {
    setup({ video: thumbVideo })

    // 2:05 is already pinned for the ImageOff fallback; this covers the
    // real-thumbnail spot (the badge is rendered in two separate branches)
    expect(screen.getByText('2:05')).toBeInTheDocument()
  })

  it('shows the bangumi preview badge when the part is a preview', () => {
    setup({ partInput: { isPreview: true } })

    expect(screen.getByText('video.bangumi_preview_badge')).toBeInTheDocument()
  })

  it('resets an edited title back to the default and saves it', async () => {
    const onValid2 = vi.fn()
    const { user } = setup({ onValid2, partInput: { title: 'Renamed Part' } })

    const reset = screen.getByRole('button', { name: 'video.reset_title' })
    expect(reset).toBeEnabled()
    await user.click(reset)

    expect(screen.getByDisplayValue('My Video Part 1')).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(onValid2).toHaveBeenCalledWith(
        0,
        'My Video Part 1',
        '',
        '',
        expect.anything(),
      ),
    )
    // form.watch is live: restoring the default re-disables the button
    expect(reset).toBeDisabled()
  })

  it('clears a validation error and saves when resetting a too-short title', async () => {
    const onValid2 = vi.fn()
    const { user } = setup({ onValid2 })

    // A one-char title trips the min(2) rule once the debounce validates
    fireEvent.change(screen.getByDisplayValue('My Video Part 1'), {
      target: { value: 'X' },
    })
    expect(
      await screen.findByText('validation.video.title.min', undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument()

    // The invalid title itself never saves (debounced validation failed)
    expect(onValid2).toHaveBeenCalledTimes(0)

    await user.click(screen.getByRole('button', { name: 'video.reset_title' }))

    // shouldValidate: true clears the error while the flush lands the save
    expect(screen.getByDisplayValue('My Video Part 1')).toBeInTheDocument()
    expect(screen.queryByText('validation.video.title.min')).toBeNull()
    await vi.waitFor(() =>
      expect(onValid2).toHaveBeenCalledWith(
        0,
        'My Video Part 1',
        '',
        '',
        expect.anything(),
      ),
    )
  })

  it('disables the reset button while the title is already the default', async () => {
    const { user } = setup()

    const reset = screen.getByRole('button', { name: 'video.reset_title' })
    expect(reset).toBeDisabled()

    // The tooltip is the icon button's only label. Hover the trigger span,
    // not the button: a disabled button's pointer-events: none would swallow
    // the hover and leave the explanation unreachable.
    await user.hover(reset.parentElement!)
    expect(
      await screen.findByText('video.reset_title_already_default', undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument()
  })

  // --- Default title computation ----------------------------------------------

  it('combines video title and part name when they differ', () => {
    setup({ partInput: { title: undefined } })

    expect(screen.getByDisplayValue('My Video Part 1')).toBeInTheDocument()
  })

  it('returns the bare video title when it equals the part name', () => {
    setup({ video: sameTitleVideo, partInput: { title: undefined } })

    expect(screen.getByDisplayValue('My Video')).toBeInTheDocument()
  })

  // --- Title textarea auto-save ----------------------------------------------

  it('debounces title validation and auto-saves after typing', async () => {
    const onValid2 = vi.fn()
    setup({ onValid2 })

    fireEvent.change(screen.getByDisplayValue('My Video Part 1'), {
      target: { value: 'Renamed Part' },
    })

    // The 500ms debounce flushes the save once the title is valid
    await vi.waitFor(
      () =>
        expect(onValid2).toHaveBeenCalledWith(
          0,
          'Renamed Part',
          '',
          '',
          expect.anything(),
        ),
      { timeout: 3000 },
    )
  })

  it('cancels the pending debounce and saves once on blur', async () => {
    const onValid2 = vi.fn()
    setup({ onValid2 })

    const input = screen.getByDisplayValue('My Video Part 1')
    fireEvent.change(input, { target: { value: 'Blurred Part' } })
    fireEvent.blur(input)

    await vi.waitFor(
      () =>
        expect(onValid2).toHaveBeenCalledWith(
          0,
          'Blurred Part',
          '',
          '',
          expect.anything(),
        ),
      { timeout: 3000 },
    )
  })

  // --- Accordion summary -------------------------------------------------------

  // The old trigger summary (resolved quality + subtitle labels) was
  // removed with the compact row; what survives on the row is the
  // resolved-fallback warning.

  it('shows the resolved-fallback warning pill when a quality substituted', () => {
    setup({
      partInput: {
        resolvedQuality: {
          videoQuality: 80,
          videoCodecid: 7,
          audioQuality: 30280,
          videoQualityFallback: true,
          audioQualityFallback: false,
        } as PartInput['resolvedQuality'],
      },
    })

    expect(screen.getByText('⚠️')).toBeInTheDocument()
  })

  it('hides the fallback warning without a substitution', () => {
    setup({
      partInput: {
        resolvedQuality: {
          videoQuality: 80,
          videoCodecid: 7,
          audioQuality: null,
        } as PartInput['resolvedQuality'],
      },
    })

    expect(screen.queryByText('⚠️')).toBeNull()
  })

  it('requires at least one subtitle language when a mode is active', () => {
    setup({
      partInput: {
        accordionOpen: true,
        videoQualities: [{ id: 80, quality: '1080p' }],
        audioQualities: [],
        subtitles: [],
        subtitle: { mode: 'soft', selectedLans: [] },
      },
    })

    expect(
      screen.getByText('video.subtitle_select_required'),
    ).toBeInTheDocument()
  })

  // --- Unavailable episodes ------------------------------------------------------

  it('shows the VIP-only warning for status 13 episodes without qualities', () => {
    setup({
      video: vipStatusBangumiVideo,
      partInput: {
        accordionOpen: true,
        videoQualities: [],
        audioQualities: [],
        subtitles: [],
      },
    })

    expect(screen.getByText('video.bangumi_vip_only')).toBeInTheDocument()
  })

  it('shows the generic unavailable warning for other statuses', () => {
    setup({
      video: noDashBangumiVideo,
      partInput: {
        accordionOpen: true,
        videoQualities: [],
        audioQualities: [],
        subtitles: [],
      },
    })

    expect(screen.getByText('video.bangumi_no_dash')).toBeInTheDocument()
  })

  // --- Audio quality radios --------------------------------------------------------

  it('renders audio quality radios and saves the default selection', async () => {
    const onValid2 = vi.fn()
    setup({
      onValid2,
      partInput: {
        accordionOpen: true,
        videoQualities: [{ id: 80, quality: '1080p' }],
        audioQualities: [{ id: 30280, quality: '192K' }],
        subtitles: [],
      },
    })

    expect(screen.getByRole('radio', { name: '192K' })).toBeEnabled()
    // The qualities effect auto-saves the first available selection
    await vi.waitFor(
      () =>
        expect(onValid2).toHaveBeenCalledWith(
          0,
          'My Video Part 1',
          '80',
          '30280',
        ),
      { timeout: 3000 },
    )
  })

  it('enables Hi-Res Lossless when the manifest offers it (issue #713)', () => {
    setup({
      partInput: {
        accordionOpen: true,
        videoQualities: [{ id: 80, quality: '1080p' }],
        audioQualities: [
          { id: 30280, quality: '192K' },
          { id: 30251, quality: 'Hi-Res Lossless' },
        ],
        subtitles: [],
      },
    })

    expect(screen.getByRole('radio', { name: 'Hi-Res Lossless' })).toBeEnabled()
    // Dolby is not offered by this manifest — stays disabled
    expect(screen.getByRole('radio', { name: 'Dolby Atmos' })).toBeDisabled()
    // Options follow the quality ladder, not numeric id order (numeric
    // order would list 192K above Hi-Res Lossless)
    // The audio pill also renders 192K (login default); the option is the
    // one wrapped in a <label>.
    const radio192k = screen
      .getAllByText('192K')
      .map((el) => el.closest('label'))
      .find(Boolean)!
    expect(
      screen.getByText('Hi-Res Lossless').compareDocumentPosition(radio192k),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('renders manifest-only audio ids as numeric options', () => {
    // Dolby variant ids outside AUDIO_QUALITIES_ORDER (e.g. 30255) must
    // still render, or a quality the backend offers could never be picked.
    setup({
      partInput: {
        accordionOpen: true,
        videoQualities: [{ id: 80, quality: '1080p' }],
        audioQualities: [
          { id: 30280, quality: '192K' },
          { id: 30255, quality: 'Dolby Digital' },
        ],
        subtitles: [],
      },
    })

    expect(screen.getByRole('radio', { name: '30255' })).toBeEnabled()
  })

  it('explains unavailable options with the logged-in reason when signed in', async () => {
    store.dispatch(setUser(userState(true)))
    try {
      const { user } = setup({
        partInput: {
          accordionOpen: true,
          videoQualities: [{ id: 80, quality: '1080p' }],
          audioQualities: [{ id: 30280, quality: '192K' }],
          subtitles: [],
        },
      })

      await user.hover(screen.getByText('Hi-Res Lossless'))

      expect(
        await screen.findAllByText('video.quality_unavailable_logged_in'),
      ).not.toHaveLength(0)
    } finally {
      store.dispatch(setUser(userState(false)))
    }
  })

  // --- Accordion open/close fetch flow --------------------------------------------

  it('fetches qualities and subtitles in parallel when opened', async () => {
    vi.mocked(fetchPartQualities).mockResolvedValue([
      [{ id: 80, quality: '1080p' }],
      [{ id: 30280, quality: '192K' }],
      false,
    ])
    vi.mocked(fetchSubtitlesForPart).mockResolvedValue([
      {
        lan: 'zh',
        lanDoc: 'Chinese',
        subtitleUrl: 'https://s.bcc',
        isAi: false,
      },
    ])
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    const part = await vi.waitFor(() => {
      const p = store.getState().input.partInputs[0]!
      expect(p.videoQualities?.length).toBe(1)
      return p
    })
    expect(part.subtitles?.length).toBe(1)
    expect(part.accordionOpen).toBe(true)
    expect(fetchPartQualities).toHaveBeenCalledWith('BV1xx411c7XD', 111)
    expect(fetchSubtitlesForPart).toHaveBeenCalledWith('BV1xx411c7XD', 111)
  })

  it('does not refetch already-loaded options on reopen', async () => {
    const { user } = setup({
      partInput: {
        videoQualities: [{ id: 80, quality: '1080p' }],
        audioQualities: [],
        subtitles: [],
      },
    })

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    expect(fetchPartQualities).not.toHaveBeenCalled()
    expect(fetchSubtitlesForPart).not.toHaveBeenCalled()
    expect(store.getState().input.partInputs[0]!.accordionOpen).toBe(true)
  })

  it('closes the accordion without fetching on the second click', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: /video.options/ }))
    await user.click(screen.getByRole('button', { name: /video.options/ }))

    expect(store.getState().input.partInputs[0]!.accordionOpen).toBe(false)
  })

  it('falls back to empty qualities when the fetch fails', async () => {
    vi.mocked(fetchPartQualities).mockRejectedValue(new Error('boom'))
    vi.mocked(fetchSubtitlesForPart).mockResolvedValue([])
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    await vi.waitFor(() => {
      const p = store.getState().input.partInputs[0]!
      expect(p.videoQualities).toEqual([])
      expect(p.qualitiesLoading).toBe(false)
    })
  })

  it('labels silent videos with the no-audio-track banner', async () => {
    // Issue #446: audio-absent videos (empty audio list + audioAbsent flag)
    // must say "no audio track", not "audio is embedded".
    vi.mocked(fetchPartQualities).mockResolvedValue([
      [{ id: 80, quality: '1080p' }],
      [],
      true,
    ])
    vi.mocked(fetchSubtitlesForPart).mockResolvedValue([])
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    await vi.waitFor(() =>
      expect(store.getState().input.partInputs[0]!.audioAbsent).toBe(true),
    )
    expect(screen.getByText('video.no_audio_track')).toBeInTheDocument()
    expect(
      screen.queryByText('video.bangumi_audio_embedded'),
    ).not.toBeInTheDocument()
  })

  it('shows the fetch-failure warning with the real cause instead of the VIP guess', async () => {
    // Issue #446: an empty qualities list used to render the misleading
    // "may be a VIP-only episode" banner even when the real cause was a
    // failed playurl fetch.
    vi.mocked(fetchPartQualities).mockRejectedValue(
      new Error('XPlayerApi Failed to parse response JSON'),
    )
    vi.mocked(fetchSubtitlesForPart).mockResolvedValue([])
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    await vi.waitFor(() => {
      const p = store.getState().input.partInputs[0]!
      expect(p.qualitiesError).toBe('XPlayerApi Failed to parse response JSON')
    })
    expect(screen.getByText('video.qualities_fetch_failed')).toBeInTheDocument()
    expect(screen.queryByText('video.bangumi_no_dash')).not.toBeInTheDocument()
  })

  it('fetches bangumi qualities through the episode endpoint', async () => {
    vi.mocked(fetchBangumiPartQualities).mockResolvedValue([
      [{ id: 80, quality: '1080p' }],
      [],
      true,
    ])
    vi.mocked(fetchSubtitlesForPart).mockResolvedValue([])
    const { user } = setup({ video: bangumiVideo })

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    await vi.waitFor(() =>
      expect(fetchBangumiPartQualities).toHaveBeenCalledWith(3051843, 111),
    )
    // isPreview from the bangumi endpoint is stored for the badge
    await vi.waitFor(() =>
      expect(store.getState().input.partInputs[0]!.isPreview).toBe(true),
    )
  })

  it('marks VIP-only bangumi parts as quality-less without fetching', async () => {
    const { user } = setup({ video: vipOnlyBangumiVideo })

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    await vi.waitFor(() =>
      expect(store.getState().input.partInputs[0]!.videoQualities).toEqual([]),
    )
    expect(fetchPartQualities).not.toHaveBeenCalled()
    expect(fetchBangumiPartQualities).not.toHaveBeenCalled()
  })

  // --- Cancel handling ------------------------------------------------------------

  it('offers no cancel affordance while queued — cancellation lives on /downloads', () => {
    setup({
      status: { downloadId: 'dl-1', isPending: true, status: 'pending' },
    })

    expect(
      screen.queryByRole('button', { name: 'actions.cancel' }),
    ).not.toBeInTheDocument()
  })

  it('covers the subtitle-fetch failure path with an empty list', async () => {
    vi.mocked(fetchPartQualities).mockResolvedValue([
      [{ id: 80, quality: '1080p' }],
      [],
      false,
    ])
    vi.mocked(fetchSubtitlesForPart).mockRejectedValue(new Error('boom'))
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    await vi.waitFor(() =>
      expect(store.getState().input.partInputs[0]!.subtitles).toEqual([]),
    )
    // Qualities still land from the parallel fetch
    await vi.waitFor(() =>
      expect(store.getState().input.partInputs[0]!.videoQualities?.length).toBe(
        1,
      ),
    )
  })

  it('scrolls the card into view after opening the accordion', async () => {
    vi.mocked(fetchPartQualities).mockResolvedValue([
      [{ id: 80, quality: '1080p' }],
      [],
      false,
    ])
    vi.mocked(fetchSubtitlesForPart).mockResolvedValue([])
    const scrollTo = vi.fn()
    Element.prototype.scrollTo = scrollTo
    store.dispatch(
      setInput({
        url: '',
        partInputs: [createPartInput()],
        pendingDownload: null,
        batchSettings: {
          videoQuality: null,
          audioQuality: null,
          subtitle: null,
        },
        homePage: 1,
      } satisfies Input),
    )
    vi.mocked(useVideoInfo).mockReturnValue(createMockVideoInfo())
    vi.mocked(usePartDownloadStatus).mockReturnValue(createMockStatus())
    const { user } = renderWithProviders(
      // Scroller-scoped reveal: the card must live inside a scrollable
      // ancestor for scrollElementWithinScroller to act.
      <div className="overflow-y-auto">
        <TooltipProvider>
          <VideoPartCard video={video} page={1} onThumbnailClick={() => {}} />
        </TooltipProvider>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    // The scroll runs on a 400ms timeout after the expand animation
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled(), {
      timeout: 2000,
    })
  })

  it('stays in full mode with no badge while another video downloads (issue #691)', () => {
    // A foreign running session must neither collapse this card nor light
    // its badge: the badge scope is videoId+cid, not part index.
    store.dispatch(
      setInput({
        url: '',
        partInputs: [createPartInput()],
        pendingDownload: null,
        batchSettings: {
          videoQuality: null,
          audioQuality: null,
          subtitle: null,
        },
        homePage: 1,
      } satisfies Input),
    )
    vi.mocked(useVideoInfo).mockReturnValue(createMockVideoInfo())
    vi.mocked(usePartDownloadStatus).mockReturnValue(createMockStatus())
    seedSession('BVother', [{ partIndex: 1, cid: 999, status: 'running' }])
    renderWithProviders(
      <TooltipProvider>
        <VideoPartCard video={video} page={1} onThumbnailClick={() => {}} />
      </TooltipProvider>,
    )

    // Full form intact
    expect(screen.getByDisplayValue('My Video Part 1')).toBeInTheDocument()
    // No queue badge for this video+cid
    expect(
      screen.queryByText('downloadStatus.status_downloading'),
    ).not.toBeInTheDocument()
  })

  it('shows the queue status badge for its own part', () => {
    setup({
      status: { downloadId: 'dl-1', status: 'running', isDownloading: true },
    })

    const badge = screen.getByText('downloadStatus.status_downloading')
    expect(badge.closest('[data-status]')).toHaveAttribute(
      'data-status',
      'running',
    )
  })
})
