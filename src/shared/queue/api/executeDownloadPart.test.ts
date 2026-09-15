/**
 * executeDownloadPart suite — locks the backend invocation shape: the FE
 * runner owns queue bookkeeping, so this wrapper's whole contract is the
 * `download_video` payload mapping and the resolved output path.
 */
import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeDownloadPart } from './executeDownloadPart'

describe('executeDownloadPart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invokes download_video with the snapshot payload verbatim', async () => {
    mockInvoke.mockResolvedValueOnce('/out/video.mp4')
    const payload = {
      videoId: 'BV1test',
      cid: 100,
      filename: 'Part 1',
      quality: 80,
      audioQuality: 30216,
      durationSeconds: 60,
      thumbnailUrl: 'https://img/t.jpg',
      page: 3,
      epId: 42,
      subtitle: { mode: 'soft' as const, selectedLans: ['zh'], subtitles: [] },
    }

    const outputPath = await executeDownloadPart(payload, {
      downloadId: 'BV1test-uuid-p3',
      parentId: 'BV1test-uuid',
    })

    expect(mockInvoke).toHaveBeenCalledWith('download_video', {
      options: {
        bvid: 'BV1test',
        cid: 100,
        filename: 'Part 1',
        quality: 80,
        audioQuality: 30216,
        downloadId: 'BV1test-uuid-p3',
        parentId: 'BV1test-uuid',
        durationSeconds: 60,
        thumbnailUrl: 'https://img/t.jpg',
        page: 3,
        epId: 42,
        subtitle: payload.subtitle,
      },
    })
    expect(outputPath).toBe('/out/video.mp4')
  })

  it('propagates the raw rejection for the runner to classify', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('ERR::CANCELLED'))
    await expect(
      executeDownloadPart(
        {
          videoId: 'BV1test',
          cid: 1,
          filename: 'x',
          quality: null,
          audioQuality: null,
          durationSeconds: 0,
          thumbnailUrl: null,
          page: null,
          epId: null,
          subtitle: null,
        },
        { downloadId: 'd1', parentId: 'p1' },
      ),
    ).rejects.toThrow('ERR::CANCELLED')
  })
})
