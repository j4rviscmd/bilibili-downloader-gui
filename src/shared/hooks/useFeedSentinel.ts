import { type RefObject, useEffect } from 'react'

/**
 * Sentinel-driven infinite scroll for card feeds, scoped to a page scroll
 * container. Shared by the popular feed and the keyword search results:
 * a 1px sentinel div at the feed tail is observed with an
 * IntersectionObserver rooted at the scroll container; entering the
 * viewport fires `onReachEnd` (loadMore), which keeps fetching until the
 * viewport is filled — large displays simply accumulate more pages.
 * The sentinel div MUST carry `shrink-0`: a flex-column scroll container
 * collapses a shrinkable 1px sentinel to 0px; on WebView2 sub-pixel layout
 * keeps it below the clip even at max scroll — infinite scroll silently stops.
 */
export function useFeedSentinel({
  scrollRootRef,
  sentinelRef,
  disabled,
  onReachEnd,
  recheckKey,
}: {
  /** Scroll container acting as the observer root (page-owned ref). */
  scrollRootRef: RefObject<HTMLDivElement | null> | undefined
  /** The sentinel element at the feed tail. */
  sentinelRef: RefObject<HTMLDivElement | null>
  /** Pauses auto-loading: end reached, or an error row owns recovery. */
  disabled: boolean
  onReachEnd: () => void
  /** Value whose change re-attaches the observer (e.g. entries.length).
   * Why: the observer fires on intersection CHANGES only — after an
   * append on a short viewport the sentinel may still be intersecting
   * without a new event, so re-attaching re-checks it. */
  recheckKey: number
}) {
  useEffect(() => {
    const root = scrollRootRef?.current
    const sentinel = sentinelRef.current
    // Why detach while disabled instead of checking inside the callback:
    // after a failed page fetch the sentinel often stays in view;
    // auto-retrying would hammer the backend in a tight loop. When the
    // error clears (retry succeeded) the effect re-runs and resumes.
    if (!root || !sentinel || disabled) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onReachEnd()
      },
      { root },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [scrollRootRef, sentinelRef, disabled, onReachEnd, recheckKey])
}
