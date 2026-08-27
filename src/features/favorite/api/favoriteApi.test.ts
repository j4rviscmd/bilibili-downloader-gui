import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchFavoriteFolders, fetchFavoriteVideos } from './favoriteApi'

const mockFolders = [
  { id: 1, title: 'Default', mediaCount: 10, upper: null },
  {
    id: 2,
    title: 'Tutorial',
    mediaCount: 3,
    upper: { mid: 42, name: 'uploader', face: 'https://face.img' },
  },
]

describe('fetchFavoriteFolders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with fetch_favorite_folders command and mid', async () => {
    mockInvoke.mockResolvedValue(mockFolders)

    const result = await fetchFavoriteFolders(42)

    expect(mockInvoke).toHaveBeenCalledWith('fetch_favorite_folders', {
      mid: 42,
    })
    expect(result).toEqual(mockFolders)
  })

  it('should return empty array when user has no folders', async () => {
    mockInvoke.mockResolvedValue([])

    await expect(fetchFavoriteFolders(42)).resolves.toEqual([])
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED')

    await expect(fetchFavoriteFolders(42)).rejects.toBe('ERR::UNAUTHORIZED')
  })
})

describe('fetchFavoriteVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with fetch_favorite_videos command and pagination args', async () => {
    const response = {
      videos: [
        {
          id: 100,
          bvid: 'BV1xx411c7XD',
          title: 'Fav video',
          cover: 'https://cover.img',
          duration: 120,
          page: 1,
          upper: { mid: 1, name: 'up', face: 'https://face.img' },
          attr: 0,
          playCount: 1000,
          collectCount: 10,
          link: 'https://www.bilibili.com/video/BV1xx411c7XD',
        },
      ],
      hasMore: false,
      totalCount: 1,
    }
    mockInvoke.mockResolvedValue(response)

    const result = await fetchFavoriteVideos(2, 1, 20)

    expect(mockInvoke).toHaveBeenCalledWith('fetch_favorite_videos', {
      mediaId: 2,
      pageNum: 1,
      pageSize: 20,
    })
    expect(result).toEqual(response)
  })

  it('should return empty list when folder has no videos', async () => {
    const empty = { videos: [], hasMore: false, totalCount: 0 }
    mockInvoke.mockResolvedValue(empty)

    await expect(fetchFavoriteVideos(2, 1, 20)).resolves.toEqual(empty)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Cookie missing'))

    await expect(fetchFavoriteVideos(2, 1, 20)).rejects.toThrow(
      'Cookie missing',
    )
  })
})
