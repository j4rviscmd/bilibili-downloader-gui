import { useAppDispatch } from '@/app/store'
import { setPendingDownload } from '@/features/video'
import { logger } from '@/shared/lib/logger'
import { useNavigate } from 'react-router'

/**
 * Hook for handling pending download navigation.
 *
 * Provides a unified interface for navigating to the search page
 * with a pending download from watch history or favorites.
 *
 * @returns handleDownload function
 *
 * @example
 * ```tsx
 * const handleDownload = usePendingDownload()
 *
 * // From watch history (has cid)
 * handleDownload(entry.bvid, entry.cid, entry.page)
 *
 * // From favorites (no cid)
 * handleDownload(video.bvid, null, video.page)
 * ```
 */
export const usePendingDownload = () => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  const handleDownload = (bvid: string, cid: number | null, page: number) => {
    logger.info(
      `usePendingDownload: Handling pending download bvid=${bvid}, page=${page}`,
    )
    dispatch(setPendingDownload({ bvid, cid, page }))
    // Why ?url= up front: exactly one history entry per destination. A
    // bare /search push lands on the empty hero and the landing push
    // (search/index.tsx entry-record effect) then stacks a ?url= entry
    // on top — browser-back returned to the empty page instead of the
    // origin page (reported 2026-10-19). The URL must byte-match the
    // one VideoInfoContext fetches for pendingDownload, or that landing
    // push fires anyway and re-stacks the entry.
    const url = `https://www.bilibili.com/video/${bvid}?p=${page}`
    navigate({ pathname: '/search', search: `?url=${encodeURIComponent(url)}` })
  }

  return handleDownload
}
