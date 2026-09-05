import { store } from '@/app/store'
import { useVideoInfo } from '@/features/video'
import {
  fetchBangumiPartQualities,
  fetchPartQualities,
  fetchSubtitlesForPart,
} from '@/features/video/api/fetchVideoInfo'
import type { PartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import { usePartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import { setInput } from '@/features/video/model/inputSlice'
import type { Input, PartInput, Video } from '@/features/video/types'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { clearQueue, enqueue } from '@/shared/queue'
import {
  createPartDownloadStatus,
  renderWithProviders,
} from '@/test/test-utils'
import { openUrl } from '@tauri-apps/plugin-opener'
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
vi.mock('@/shared/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'

const toastSuccess = toast.success as unknown as Mock
const toastError = toast.error as unknown as Mock
const mockOpenUrl = openUrl as unknown as Mock

/** Minimal single-part video the card is rendered against. */
const video: Video = {
  title: 'My Video',
  bvid: 'BV1xx411c7XD',
  contentType: 'video',
  isLimitedQuality: false,
  parts: [
    {
      part: 'Part 1',
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

/** Idle status the mocked hook returns by default. */
const createMockStatus = createPartDownloadStatus

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

/** Builds the useVideoInfo value the card consumes. */
function createMockVideoInfo(
  overrides: Partial<ReturnType<typeof useVideoInfo>> = {},
): ReturnType<typeof useVideoInfo> {
  return {
    onValid2: vi.fn(),
    onValid1: vi.fn(),
    download: vi.fn(),
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
  status?: Partial<PartDownloadStatus>
  isDuplicate?: boolean
  /** Overrides the default single-part video fixture. */
  video?: Video
  /** onValid2 spy installed into the mocked useVideoInfo value. */
  onValid2?: Mock
}

/** Seeds the input slice plus both mocked hooks, then renders the card. */
function setup({
  partInput = {},
  status = {},
  isDuplicate,
  video: videoFixture,
  onValid2,
}: SetupOptions = {}) {
  store.dispatch(
    setInput({
      url: '',
      partInputs: [createPartInput(partInput)],
      pendingDownload: null,
      homePage: 1,
    } satisfies Input),
  )
  vi.mocked(useVideoInfo).mockReturnValue(
    createMockVideoInfo(onValid2 ? { onValid2 } : {}),
  )
  vi.mocked(usePartDownloadStatus).mockReturnValue(createMockStatus(status))
  return renderWithProviders(
    // The app wraps cards in a global TooltipProvider; the part-name
    // Tooltip relies on it and would throw bare.
    <TooltipProvider>
      <VideoPartCard
        video={videoFixture ?? video}
        page={1}
        isDuplicate={isDuplicate}
      />
    </TooltipProvider>,
  )
}

// --- Video fixtures for the extended tests below -----------------------------

/** Part under a minute long, with a thumbnail. */
const thumbVideo: Video = {
  ...video,
  parts: [
    {
      ...video.parts[0]!,
      thumbnail: { url: 'https://img.example/t.jpg' },
    },
  ],
}

/** Part under a minute long (no minute span rendered). */
const shortVideo: Video = {
  ...video,
  parts: [{ ...video.parts[0]!, duration: 42 }],
}

/** Single part whose name equals the video title. */
const sameTitleVideo: Video = {
  ...video,
  parts: [{ ...video.parts[0]!, part: 'My Video' }],
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
    store.dispatch(clearQueue())
  })

  it('renders the page badge, default title, part name and duration', () => {
    setup()

    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('Part 1')).toBeInTheDocument()
    // 125s renders as separate "2m" and "5s" spans
    expect(screen.getByText('2m')).toBeInTheDocument()
    expect(screen.getByText('5s')).toBeInTheDocument()
    expect(screen.getByDisplayValue('My Video Part 1')).toBeInTheDocument()
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

    // 1080p is available; 4K Dolby Vision (id 120) is not in the store list
    expect(screen.getByRole('radio', { name: '1080p' })).toBeEnabled()
    expect(
      screen.getByRole('radio', { name: '4K Dolby Vision' }),
    ).toBeDisabled()

    // No audio qualities -> embedded-audio info box instead of a radio group
    expect(screen.getByText('video.bangumi_audio_embedded')).toBeInTheDocument()
  })

  it('disables all inputs while the part is downloading', () => {
    setup({ status: { downloadId: 'dl-1', isDownloading: true } })

    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByDisplayValue('My Video Part 1')).toBeDisabled()
  })

  it('shows the download progress area once the part is enqueued', () => {
    setup({ status: { downloadId: 'dl-1', isPending: true } })

    expect(screen.getByText('video.download_pending')).toBeInTheDocument()
  })

  it('deselects the part exactly when the download completes', () => {
    const { rerender } = setup()

    // Simulate the false -> true isComplete transition on rerender.
    // rerender drops the providers applied by renderWithProviders, so wrap.
    vi.mocked(usePartDownloadStatus).mockReturnValue(
      createMockStatus({ downloadId: 'dl-1', isComplete: true }),
    )
    rerender(
      <Provider store={store}>
        <MemoryRouter>
          <TooltipProvider>
            <VideoPartCard video={video} page={1} />
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

  it('renders the thumbnail and opens the video in the browser on click', async () => {
    const { user } = setup({ video: thumbVideo })

    await user.click(screen.getByRole('img'))

    expect(mockOpenUrl).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1xx411c7XD',
    )
  })

  // --- Part name / duration row ----------------------------------------------

  it('shows only the seconds span for parts shorter than a minute', () => {
    setup({ video: shortVideo })

    expect(screen.getByText('42s')).toBeInTheDocument()
    expect(screen.queryByText('0m')).toBeNull()
  })

  it('shows the bangumi preview badge when the part is a preview', () => {
    setup({ partInput: { isPreview: true } })

    expect(screen.getByText('video.bangumi_preview_badge')).toBeInTheDocument()
  })

  it('copies the part name to the clipboard and toasts success', async () => {
    const { user } = setup()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    await user.click(screen.getByTitle('video.copy_title'))

    await vi.waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('video.title_copied'),
    )
  })

  it('toasts an error when copying the part name fails', async () => {
    const { user } = setup()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })

    await user.click(screen.getByTitle('video.copy_title'))

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('video.copy_failed'),
    )
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
      () => expect(onValid2).toHaveBeenCalledWith(0, 'Renamed Part', '', ''),
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
      () => expect(onValid2).toHaveBeenCalledWith(0, 'Blurred Part', '', ''),
      { timeout: 3000 },
    )
  })

  // --- Accordion summary -------------------------------------------------------

  it('summarizes the resolved quality and subtitle in the trigger', () => {
    setup({
      partInput: {
        resolvedQuality: {
          videoQuality: 80,
          videoCodecid: 7,
          audioQuality: 30280,
          videoQualityFallback: true,
          audioQualityFallback: false,
        } as PartInput['resolvedQuality'],
        resolvedSubtitle: {
          subtitleMode: 'soft',
          subtitleLanguageLabels: ['zh-Hans', 'en', 'ja'],
        } as PartInput['resolvedSubtitle'],
      },
    })

    const trigger = screen.getByRole('button', { name: /video.options/ })
    expect(trigger).toHaveTextContent('1080p(AVC)')
    expect(trigger).toHaveTextContent('192K')
    // More than two languages collapse into a count
    expect(trigger).toHaveTextContent('video.subtitle_n_languages')
    // Substituted-quality warning icon
    expect(screen.getByText('⚠️')).toBeInTheDocument()
  })

  it('joins up to two subtitle labels and hides the fallback icon', () => {
    setup({
      partInput: {
        resolvedQuality: {
          videoQuality: 80,
          videoCodecid: 7,
          audioQuality: null,
        } as PartInput['resolvedQuality'],
        resolvedSubtitle: {
          subtitleMode: 'hard',
          subtitleLanguageLabels: ['zh-Hans', 'en'],
        } as PartInput['resolvedSubtitle'],
      },
    })

    const trigger = screen.getByRole('button', { name: /video.options/ })
    expect(trigger).toHaveTextContent('zh-Hans・en')
    expect(trigger).toHaveTextContent('video.subtitle_hard')
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

  // --- Accordion open/close fetch flow --------------------------------------------

  it('fetches qualities and subtitles in parallel when opened', async () => {
    vi.mocked(fetchPartQualities).mockResolvedValue([
      [{ id: 80, quality: '1080p' }],
      [{ id: 30280, quality: '192K' }],
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

  it('cancels the pending download and deselects the part', async () => {
    const { user } = setup({ status: { downloadId: 'dl-1', isPending: true } })

    await user.click(screen.getByRole('button', { name: 'actions.cancel' }))

    await vi.waitFor(() =>
      expect(store.getState().input.partInputs[0]!.selected).toBe(false),
    )
  })

  it('covers the subtitle-fetch failure path with an empty list', async () => {
    vi.mocked(fetchPartQualities).mockResolvedValue([
      [{ id: 80, quality: '1080p' }],
      [],
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
    ])
    vi.mocked(fetchSubtitlesForPart).mockResolvedValue([])
    const scrollTo = vi.fn()
    Element.prototype.scrollTo = scrollTo
    store.dispatch(
      setInput({
        url: '',
        partInputs: [createPartInput()],
        pendingDownload: null,
        homePage: 1,
      } satisfies Input),
    )
    vi.mocked(useVideoInfo).mockReturnValue(createMockVideoInfo())
    vi.mocked(usePartDownloadStatus).mockReturnValue(createMockStatus())
    const { user } = renderWithProviders(
      <div data-part-list>
        <TooltipProvider>
          <VideoPartCard video={video} page={1} />
        </TooltipProvider>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: /video.options/ }))

    // The scroll runs on a 400ms timeout after the expand animation
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled(), {
      timeout: 2000,
    })
  })

  it('collapses into the compact waiting row while another download is active', () => {
    // A foreign running child download keeps this part waiting for its turn;
    // the card body collapses into the compact single-line row (issue #569).
    store.dispatch(enqueue({ downloadId: 'other', status: 'pending' }))
    store.dispatch(
      enqueue({
        downloadId: 'other-p1',
        parentId: 'other',
        status: 'running',
      }),
    )
    setup()

    expect(
      screen.getAllByText('downloadStatus.status_waiting').length,
    ).toBeGreaterThan(0)
    // The full form is swapped out while compact
    expect(
      screen.queryByDisplayValue('My Video Part 1'),
    ).not.toBeInTheDocument()
  })
})
