import type { ContentType, VideoPart } from '../types'
import { PARTS_PER_PAGE } from './constants'

/**
 * Context used to decide the initial selection state of a part.
 */
export type SelectionContext = {
  /** Content type of the fetched video ("video" or "bangumi"). */
  contentType: ContentType
  /**
   * Episode ID requested via the bangumi URL (e.g. ep825757).
   *
   * Populated by the backend on the top-level `Video.epId` field for
   * bangumi content. Undefined for regular videos.
   */
  videoEpId?: number
  /**
   * Pending download from history/favorites, or a video `?p=N` URL.
   *
   * Null when the URL does not identify a specific part (e.g. a plain
   * video URL without `?p`, or a bangumi URL — bangumi is handled via
   * `videoEpId` instead).
   */
  pending: { bvid: string; cid: number | null; page: number } | null
}

/**
 * Determines whether a part should be initially selected after fetching.
 *
 * Selection priority:
 * 1. Bangumi with a requested `videoEpId` → only the matching episode.
 *    A bangumi URL always targets one episode (via epId), so selecting
 *    only that episode prevents silently queuing an entire season.
 * 2. Pending download (cid/page) → the specific part from a `?p=N` URL
 *    or from history/favorites navigation.
 * 3. Otherwise → only the first page (`index < PARTS_PER_PAGE`). This
 *    avoids queuing every part of a large multi-part video when the URL
 *    does not name a specific part.
 *
 * @param part - The video part to evaluate.
 * @param index - Zero-based index of the part within `video.parts`.
 * @param ctx - Selection context describing how the fetch was initiated.
 * @returns True if the part should be selected by default.
 */
export const shouldSelectPart = (
  part: VideoPart,
  index: number,
  ctx: SelectionContext,
): boolean => {
  if (ctx.contentType === 'bangumi' && ctx.videoEpId !== undefined) {
    return part.epId === ctx.videoEpId
  }
  if (ctx.pending) {
    return ctx.pending.cid !== null
      ? part.cid === ctx.pending.cid
      : part.page === ctx.pending.page
  }
  return index < PARTS_PER_PAGE
}
