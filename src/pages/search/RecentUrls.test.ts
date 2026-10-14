import type { HistoryEntry } from '@/features/history/model/historySlice'
import { describe, expect, it } from 'vitest'
import { groupRecentUrls } from './RecentUrls'

/** Builds a history entry with overrides for the fields we exercise. */
function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: overrides.id ?? 'e1',
    title: 'T',
    bvid: undefined,
    url: 'https://www.bilibili.com/video/BV1x',
    downloadedAt: '2026-10-14T00:00:00Z',
    status: 'completed',
    ...overrides,
  }
}

describe('groupRecentUrls', () => {
  it('groups by bvid, newest entry wins, completed counted', () => {
    const rows = groupRecentUrls([
      entry({
        id: 'a1',
        bvid: 'BV1',
        title: 'old',
        downloadedAt: '2026-10-12T00:00:00Z',
        status: 'completed',
      }),
      entry({
        id: 'a2',
        bvid: 'BV1',
        title: 'new',
        downloadedAt: '2026-10-14T00:00:00Z',
        status: 'failed',
      }),
      entry({
        id: 'a3',
        bvid: 'BV1',
        downloadedAt: '2026-10-13T00:00:00Z',
        status: 'completed',
      }),
      entry({
        id: 'b1',
        bvid: 'BV2',
        downloadedAt: '2026-10-13T12:00:00Z',
        status: 'completed',
      }),
    ])
    expect(rows).toHaveLength(2)
    // Newest group first; title/url from the group's newest entry.
    expect(rows[0]).toMatchObject({
      title: 'new',
      url: expect.stringContaining('BV1'),
    })
    // Completed count excludes the failed entry.
    expect(rows[0]!.completedCount).toBe(2)
    expect(rows[1]!.completedCount).toBe(1)
  })

  it('falls back to url grouping when bvid is missing', () => {
    const rows = groupRecentUrls([
      entry({
        id: 'c1',
        url: 'https://www.bilibili.com/video/BV1',
        downloadedAt: '2026-10-14T00:00:00Z',
      }),
      entry({
        id: 'c2',
        url: 'https://www.bilibili.com/video/BV1',
        downloadedAt: '2026-10-13T00:00:00Z',
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.completedCount).toBe(2)
  })

  it('caps the row count at the limit', () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      entry({
        id: `d${i}`,
        bvid: `BV${i}`,
        downloadedAt: `2026-10-0${i + 1}T00:00:00Z`,
      }),
    )
    expect(groupRecentUrls(entries, 5)).toHaveLength(5)
  })
})
