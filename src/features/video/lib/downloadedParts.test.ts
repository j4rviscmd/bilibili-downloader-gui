import { describe, expect, it } from 'vitest'
import { collectDownloadedPartIndices } from './downloadedParts'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import type { QueueItem } from '@/shared/queue'

function history(
  overrides: Partial<HistoryEntry> & Pick<HistoryEntry, 'id' | 'url'>,
): HistoryEntry {
  return {
    title: 't',
    downloadedAt: '2026-08-27T00:00:00Z',
    status: 'completed',
    ...overrides,
  }
}

describe('collectDownloadedPartIndices', () => {
  it('collects done queue items by -pN downloadId', () => {
    const queue: QueueItem[] = [
      { downloadId: 'bv-uuid-p1', status: 'done' },
      { downloadId: 'bv-uuid-p2', status: 'pending' },
      { downloadId: 'bv-uuid-p3', status: 'done' },
      { downloadId: 'bv-uuid', status: 'done' },
    ]

    expect(
      collectDownloadedPartIndices({
        queue,
        historyEntries: [],
        videoBvid: 'BV1xx',
        partCount: 10,
      }),
    ).toEqual([0, 2])
  })

  it('matches completed history entries for the same bvid and page', () => {
    const historyEntries = [
      history({
        id: '1',
        bvid: 'BV1xx',
        url: 'https://www.bilibili.com/video/BV1xx?p=4',
      }),
      history({
        id: '2',
        bvid: 'BV1yy',
        url: 'https://www.bilibili.com/video/BV1yy?p=1',
      }),
      history({
        id: '3',
        bvid: 'BV1xx',
        url: 'https://www.bilibili.com/video/BV1xx?p=4',
        status: 'failed',
      }),
    ]

    expect(
      collectDownloadedPartIndices({
        queue: [],
        historyEntries,
        videoBvid: 'BV1xx',
        partCount: 10,
      }),
    ).toEqual([3])
  })

  it('treats a history URL without ?p= as page 1', () => {
    expect(
      collectDownloadedPartIndices({
        queue: [],
        historyEntries: [
          history({
            id: '1',
            bvid: 'BV1xx',
            url: 'https://www.bilibili.com/video/BV1xx',
          }),
        ],
        videoBvid: 'BV1xx',
        partCount: 10,
      }),
    ).toEqual([0])
  })

  it('matches bangumi history stored as av{aid}', () => {
    expect(
      collectDownloadedPartIndices({
        queue: [],
        historyEntries: [
          history({
            id: '1',
            bvid: 'av111',
            url: 'https://www.bilibili.com/video/av111?p=2',
          }),
        ],
        videoBvid: 'BV1ep',
        partCount: 5,
        firstPartAid: 111,
      }),
    ).toEqual([1])
  })

  it('ignores pages outside the current part list', () => {
    expect(
      collectDownloadedPartIndices({
        queue: [{ downloadId: 'bv-uuid-p99', status: 'done' }],
        historyEntries: [],
        videoBvid: 'BV1xx',
        partCount: 3,
      }),
    ).toEqual([])
  })
})
