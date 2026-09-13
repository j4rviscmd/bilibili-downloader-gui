import { useVideoInfo } from '@/features/video'
import type { Input } from '@/features/video/types'
import { renderWithProviders, resetQueue, seedSession } from '@/test/test-utils'
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

describe('DownloadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueue()
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

  it('stays enabled and keeps the idle label while a queue session runs (issue #691)', () => {
    // Downloads no longer lock the button — clicking enqueues another
    // session; the duplicate guard at enqueue time handles conflicts.
    seedSession('BVbtn1', [{ partIndex: 1, cid: 1, status: 'running' }])

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeEnabled()
  })

  it('is enabled once every enqueued part is done', () => {
    seedSession('BVbtn2', [{ partIndex: 1, cid: 1, status: 'done' }])

    renderWithProviders(<DownloadButton />)

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
