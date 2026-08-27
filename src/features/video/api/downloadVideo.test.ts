import { store } from '@/app/store'
import { clearQueue, enqueue } from '@/shared/queue/queueSlice'
import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadVideo } from './downloadVideo'

const findItem = (downloadId: string) =>
  store.getState().queue.find((q) => q.downloadId === downloadId)

describe('downloadVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.dispatch(clearQueue())
  })

  it('should enqueue, invoke download_video with full options, and mark done', async () => {
    mockInvoke.mockResolvedValue('/downloads/My Video.mp4')

    await downloadVideo(
      'BV1xx411c7XD',
      123456,
      'My Video',
      80,
      30216,
      'BV1xx411c7XD-1234567890-p1',
      'BV1xx411c7XD-1234567890',
      360,
      'https://thumb.img',
      1,
      undefined,
      undefined,
      42,
    )

    expect(mockInvoke).toHaveBeenCalledWith('download_video', {
      options: {
        bvid: 'BV1xx411c7XD',
        cid: 123456,
        filename: 'My Video',
        quality: 80,
        audioQuality: 30216,
        downloadId: 'BV1xx411c7XD-1234567890-p1',
        parentId: 'BV1xx411c7XD-1234567890',
        durationSeconds: 360,
        thumbnailUrl: 'https://thumb.img',
        page: 1,
        epId: 42,
        subtitle: null,
      },
    })

    const item = findItem('BV1xx411c7XD-1234567890-p1')
    expect(item).toMatchObject({
      outputPath: '/downloads/My Video.mp4',
      title: 'My Video',
      status: 'done',
    })
  })

  it('should default optional fields when omitted', async () => {
    mockInvoke.mockResolvedValue('/out.mp4')

    await downloadVideo('BV1', 1, 'name', null, null, 'BV1-1-p1')

    expect(mockInvoke).toHaveBeenCalledWith('download_video', {
      options: {
        bvid: 'BV1',
        cid: 1,
        filename: 'name',
        quality: null,
        audioQuality: null,
        downloadId: 'BV1-1-p1',
        parentId: null,
        durationSeconds: 0,
        thumbnailUrl: null,
        page: null,
        epId: null,
        subtitle: null,
      },
    })
  })

  it('should filter subtitles down to the selected languages', async () => {
    mockInvoke.mockResolvedValue('/out.mp4')

    await downloadVideo(
      'BV1',
      1,
      'name',
      80,
      30216,
      'id-1',
      undefined,
      undefined,
      undefined,
      undefined,
      {
        mode: 'soft',
        selectedLans: ['zh-CN'],
      },
      [
        {
          lan: 'zh-CN',
          lanDoc: '中文',
          subtitleUrl: 'https://s/zh.json',
          isAi: false,
        },
        {
          lan: 'en',
          lanDoc: 'English',
          subtitleUrl: 'https://s/en.json',
          isAi: true,
        },
      ],
    )

    const options = mockInvoke.mock.calls[0][1].options
    expect(options.subtitle).toEqual({
      mode: 'soft',
      selectedLans: ['zh-CN'],
      subtitles: [
        {
          lan: 'zh-CN',
          lanDoc: '中文',
          subtitleUrl: 'https://s/zh.json',
          isAi: false,
        },
      ],
    })
  })

  it('should mark the queue item as error and rethrow on failure', async () => {
    mockInvoke.mockRejectedValue(new Error('ERR::DISK_FULL'))

    await expect(
      downloadVideo('BV1', 1, 'name', 80, null, 'id-err'),
    ).rejects.toThrow('ERR::DISK_FULL')

    expect(findItem('id-err')).toMatchObject({
      status: 'error',
      errorMessage: 'ERR::DISK_FULL',
    })
  })

  it('should not mark as error when the rejection is cancel-induced', async () => {
    mockInvoke.mockRejectedValue('ERR::CANCELLED')

    await expect(
      downloadVideo('BV1', 1, 'name', 80, null, 'id-cancel'),
    ).rejects.toBe('ERR::CANCELLED')

    expect(findItem('id-cancel')?.status).toBe('pending')
    expect(findItem('id-cancel')?.errorMessage).toBeUndefined()
  })

  it('should not mark child as error while its parent is cancelling', async () => {
    // A cancelling sibling keeps the aggregated parent status 'cancelling'
    // even after downloadVideo enqueues the child under test as pending.
    store.dispatch(
      enqueue({
        downloadId: 'parent-1',
        filename: 'parent',
        status: 'pending',
      }),
    )
    store.dispatch(
      enqueue({
        downloadId: 'sibling-1',
        parentId: 'parent-1',
        filename: 'sibling',
        status: 'cancelling',
      }),
    )
    mockInvoke.mockRejectedValue(new Error('ERR::DISK_FULL'))

    await expect(
      downloadVideo('BV1', 1, 'child', 80, null, 'child-1', 'parent-1'),
    ).rejects.toThrow('ERR::DISK_FULL')

    expect(findItem('parent-1')?.status).toBe('cancelling')
    expect(findItem('child-1')?.status).toBe('pending')
  })
})
