import { useAppDispatch } from '@/app/store'
import { setPendingDownload } from '@/features/video'
import { useNavigate } from 'react-router'

/**
 * Hook for handling pending download navigation.
 *
 * Provides a unified interface for navigating to the home page
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
    dispatch(setPendingDownload({ bvid, cid, page }))
    navigate('/home')
  }

  return handleDownload
}
