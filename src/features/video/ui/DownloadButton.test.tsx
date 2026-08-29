import { store } from '@/app/store'
import { useVideoInfo } from '@/features/video'
import type { Input } from '@/features/video/types'
import { clearQueue, enqueue } from '@/shared/queue'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DownloadButton from './DownloadButton'

// useVideoInfo is fully covered by its own tests; mock the hook so this
// suite controls only the inputs DownloadButton branches on.
vi.mock('@/features/video', () => ({
  useVideoInfo: vi.fn(),
}))

const emptyInput: Input = {
  url: 'https://www.bilibili.com/video/BV1xx411c7XD',
  partInputs: [],
  pendingDownload: null,
  homePage: 1,
}

/** Builds a useVideoInfo return value with the "ready to download" defaults. */
function createMockUseVideoInfo(
  overrides: Partial<ReturnType<typeof useVideoInfo>> = {},
): ReturnType<typeof useVideoInfo> {
  return {
    download: vi.fn(),
    isForm1Valid: true,
    isForm2ValidAll: true,
    duplicateIndices: [],
    selectedCount: 1,
    input: emptyInput,
    ...overrides,
  } as ReturnType<typeof useVideoInfo>
}

/** Enqueues a parent + child so selectHasActiveDownloads matches. */
function seedRunningDownload() {
  store.dispatch(
    enqueue({ downloadId: 'p1', filename: 'parent', status: 'running' }),
  )
  store.dispatch(
    enqueue({ downloadId: 'p1-p1', parentId: 'p1', status: 'running' }),
  )
}

describe('DownloadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.dispatch(clearQueue())
    vi.mocked(useVideoInfo).mockReturnValue(createMockUseVideoInfo())
  })

  it('is enabled when all validations pass and starts the download', async () => {
    const download = vi.fn()
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download }),
    )
    const { user: actor } = renderWithProviders(<DownloadButton />)

    const button = screen.getByRole('button', { name: 'actions.download' })
    expect(button).toBeEnabled()

    await actor.click(button)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('shows the downloading label and disables while a download runs', () => {
    seedRunningDownload()

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'video.downloading' }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'actions.download' }),
    ).not.toBeInTheDocument()
  })

  it('shows the cancelling label while a download is being cancelled', () => {
    store.dispatch(enqueue({ downloadId: 'p1', status: 'cancelling' }))

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'video.download_cancelling' }),
    ).toBeDisabled()
  })

  it('returns to the idle label once every download is done', () => {
    store.dispatch(enqueue({ downloadId: 'p1-p1', status: 'done' }))

    renderWithProviders(<DownloadButton />)

    // 'done' items are not active downloads, so the button re-enables
    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeEnabled()
  })

  it('is disabled when the URL form is invalid', () => {
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ isForm1Valid: false }),
    )

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeDisabled()
  })

  it('is disabled when the part-settings form is invalid', () => {
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ isForm2ValidAll: false }),
    )

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeDisabled()
  })
})
