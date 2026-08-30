/**
 * FavoriteItem suite.
 *
 * Pure presentational entry card: asserts rendered metadata (thumbnail,
 * duration badge, uploader, play/collect counts), the deleted-video state,
 * and the copy / download interactions. Toast is mocked locally.
 */

import type { FavoriteVideo } from '@/features/favorite/types'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'
import FavoriteItem from './FavoriteItem'

const toastSuccess = toast.success as unknown as Mock
const toastError = toast.error as unknown as Mock

const video: FavoriteVideo = {
  id: 1,
  bvid: 'BV1xx411c7XD',
  page: 1,
  title: 'Sample Favorite',
  cover: 'https://img.example/cover.jpg',
  duration: 3725, // 1:02:05
  attr: 0,
  link: 'https://www.bilibili.com/video/BV1x',
  playCount: 1234567,
  collectCount: 543,
  upper: { mid: 42, name: 'uploader', face: 'https://img.example/face.jpg' },
}

const writeText = vi.fn().mockResolvedValue(undefined)

function renderVideo(overrides: Partial<FavoriteVideo> = {}) {
  const onDownload = vi.fn()
  const utils = renderWithProviders(
    <FavoriteItem video={{ ...video, ...overrides }} onDownload={onDownload} />,
  )
  return { ...utils, onDownload }
}

describe('FavoriteItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title, uploader, url and formatted metadata', () => {
    renderVideo()

    expect(screen.getByText('Sample Favorite')).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'https://www.bilibili.com/video/BV1xx411c7XD',
      }),
    ).toBeInTheDocument()
    // 1:02:05 duration badge
    expect(screen.getByText('1:02:05')).toBeInTheDocument()
    // 1.2M plays / 543 collects
    expect(screen.getByText('1.2M favorite.plays')).toBeInTheDocument()
    expect(screen.getByText('543 favorite.collects')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'uploader' })).toHaveAttribute(
      'href',
      'https://space.bilibili.com/42',
    )
  })

  it('renders the cover and uploader avatar when provided', () => {
    renderVideo()

    expect(
      screen.getByRole('img', { name: 'Sample Favorite' }),
    ).toHaveAttribute('src', 'https://img.example/cover.jpg')
    expect(screen.getByRole('img', { name: 'uploader' })).toHaveAttribute(
      'src',
      'https://img.example/face.jpg',
    )
  })

  it('falls back to placeholders when cover and avatar are missing', () => {
    renderVideo({ cover: '', upper: { ...video.upper, face: '' } })

    expect(screen.queryByRole('img')).toBeNull()
  })

  it('marks deleted videos and keeps them rendered', () => {
    renderVideo({ attr: 2 })

    expect(screen.getByText('favorite.videoDeleted')).toBeInTheDocument()
    expect(screen.getByText('Sample Favorite')).toBeInTheDocument()
  })

  it('builds the page-2 URL for multi-page entries', () => {
    renderVideo({ page: 2 })

    expect(
      screen.getByRole('link', {
        name: 'https://www.bilibili.com/video/BV1xx411c7XD?p=2',
      }),
    ).toBeInTheDocument()
  })

  it('copies the URL to the clipboard and toasts success', async () => {
    const { user } = renderVideo()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    await user.click(screen.getByTitle('history.copyUrl'))

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://www.bilibili.com/video/BV1xx411c7XD',
      ),
    )
    expect(toastSuccess).toHaveBeenCalledWith('history.copySuccess')
  })

  it('toasts an error when the clipboard write fails', async () => {
    const { user } = renderVideo()
    // Clipboard stub must be installed AFTER render (happy-dom quirk)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })

    await user.click(screen.getByTitle('history.copyUrl'))

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('history.copyFailed'),
    )
  })

  it('invokes onDownload from the download button', async () => {
    const { user, onDownload } = renderVideo()

    await user.click(screen.getByRole('button', { name: 'favorite.download' }))

    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('disables the download button and explains why when disabled', async () => {
    const { user } = renderWithProviders(
      <FavoriteItem video={video} onDownload={vi.fn()} disabled />,
    )

    const button = screen.getByRole('button', {
      name: 'favorite.download',
    })
    expect(button).toBeDisabled()
    // Hover the wrapper span (the trigger) so the reason tooltip opens
    await user.hover(button)
    // Radix may keep re-rendering the portal content; at least one instance
    // of the reason text must be present.
    expect(
      await screen.findAllByText('video.download_in_progress'),
    ).not.toHaveLength(0)
  })
})
