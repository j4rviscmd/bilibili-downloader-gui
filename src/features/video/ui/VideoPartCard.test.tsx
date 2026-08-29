import { store } from '@/app/store'
import { useVideoInfo } from '@/features/video'
import type { PartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import { usePartDownloadStatus } from '@/features/video/hooks/usePartDownloadStatus'
import { setInput } from '@/features/video/model/inputSlice'
import type { Input, PartInput, Video } from '@/features/video/types'
import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
import { clearQueue } from '@/shared/queue'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
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
function createMockStatus(
  overrides: Partial<PartDownloadStatus> = {},
): PartDownloadStatus {
  return {
    downloadId: undefined,
    status: undefined,
    errorMessage: undefined,
    outputPath: undefined,
    filename: undefined,
    progressEntries: [],
    isComplete: false,
    isDownloading: false,
    isPending: false,
    hasError: false,
    isCancelling: false,
    isCancelled: false,
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

/** Builds the useVideoInfo value the card consumes. */
function createMockVideoInfo(): ReturnType<typeof useVideoInfo> {
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
  } as ReturnType<typeof useVideoInfo>
}

type SetupOptions = {
  partInput?: Partial<PartInput>
  status?: Partial<PartDownloadStatus>
  isDuplicate?: boolean
}

/** Seeds the input slice plus both mocked hooks, then renders the card. */
function setup({
  partInput = {},
  status = {},
  isDuplicate,
}: SetupOptions = {}) {
  store.dispatch(
    setInput({
      url: '',
      partInputs: [createPartInput(partInput)],
      pendingDownload: null,
      homePage: 1,
    } satisfies Input),
  )
  vi.mocked(useVideoInfo).mockReturnValue(createMockVideoInfo())
  vi.mocked(usePartDownloadStatus).mockReturnValue(createMockStatus(status))
  return renderWithProviders(
    // The app wraps cards in a global TooltipProvider; the part-name
    // Tooltip relies on it and would throw bare.
    <TooltipProvider>
      <VideoPartCard video={video} page={1} isDuplicate={isDuplicate} />
    </TooltipProvider>,
  )
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
})
