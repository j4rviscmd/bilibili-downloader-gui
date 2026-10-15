import { getHistory } from '@/features/history/api/historyApi'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * One recent-URL row derived from download history: the newest entry per
 * video (bvid), with the count of completed downloads for that video.
 *
 * Total part counts are intentionally NOT shown — history only records
 * what was actually downloaded, so the honest number is "N downloaded".
 */
export type RecentUrl = {
  /** Video title (from the newest entry of the group). */
  title: string
  /** Canonical video URL (from the newest entry). */
  url: string
  /** Thumbnail URL, when the newest entry carries one. */
  thumbnailUrl: string | null
  /** ISO timestamp of the newest entry in the group. */
  downloadedAt: string
  /** Completed download count for this video. */
  completedCount: number
}

/**
 * Groups download history entries into recent URLs, newest first.
 *
 * @param entries - Raw history entries (any order)
 * @param limit - Maximum rows to return
 * @returns Grouped recent URLs
 */
export function groupRecentUrls(
  entries: readonly HistoryEntry[],
  limit = 5,
): RecentUrl[] {
  const groups = new Map<string, HistoryEntry[]>()
  for (const e of entries) {
    const key = e.bvid ?? e.url
    const bucket = groups.get(key)
    if (bucket) bucket.push(e)
    else groups.set(key, [e])
  }
  const rows: RecentUrl[] = []
  for (const bucket of groups.values()) {
    const sorted = [...bucket].sort((a, b) =>
      b.downloadedAt.localeCompare(a.downloadedAt),
    )
    const newest = sorted[0]!
    rows.push({
      title: newest.title,
      url: newest.url,
      thumbnailUrl: newest.thumbnailUrl ?? null,
      downloadedAt: newest.downloadedAt,
      completedCount: sorted.filter((e) => e.status === 'completed').length,
    })
  }
  return rows
    .sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt))
    .slice(0, limit)
}

/**
 * Recent URLs list for the empty state. Data comes from the existing
 * download history (history.json via get_history) — no new persistence.
 *
 * @example
 * ```tsx
 * <RecentUrls onRefetch={(url) => onValid1(url)} />
 * ```
 */
export function RecentUrls({
  onRefetch,
}: {
  onRefetch: (url: string) => void
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<RecentUrl[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getHistory()
      .then((entries) => {
        if (!cancelled) setRows(groupRecentUrls(entries))
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const relative = useMemo(() => {
    if (rows === null) return new Map<string, string>()
    const now = Date.now()
    const labels = new Map<string, string>()
    for (const r of rows) {
      const hours = Math.max(
        0,
        Math.round((now - Date.parse(r.downloadedAt)) / 3_600_000),
      )
      labels.set(
        r.url,
        hours < 1
          ? t('search.recent_just_now')
          : hours < 24
            ? t('search.recent_hours_ago', { count: hours })
            : t('search.recent_days_ago', {
                count: Math.round(hours / 24),
              }),
      )
    }
    return labels
  }, [rows, t])

  if (rows === null || rows.length === 0) return null

  return (
    <div className="w-full max-w-2xl">
      <h3 className="text-muted-foreground mb-2 px-1 text-xs font-semibold tracking-wide">
        {t('search.recent_title')}
      </h3>
      <div data-recent-urls>
        {rows.map((r) => (
          <button
            key={r.url}
            type="button"
            onClick={() => onRefetch(r.url)}
            className="group/recent hover:bg-muted flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors"
          >
            {r.thumbnailUrl ? (
              <img
                src={r.thumbnailUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="block aspect-video w-16 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="bg-muted block aspect-video w-16 shrink-0 rounded" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-[1.6] font-medium">
                {r.title}
              </span>
              <span className="text-muted-foreground mt-[3px] block text-[11px] leading-[1.6]">
                {t('search.recent_downloaded', { count: r.completedCount })}
                {' · '}
                {relative.get(r.url)}
              </span>
            </span>
            <span className="text-brand-strong dark:text-brand focus-within/recent:opacity-100 shrink-0 text-xs font-semibold opacity-0 transition-opacity group-hover/recent:opacity-100">
              {t('search.recent_refetch')}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default RecentUrls
