import type { RootState } from '@/app/store'
import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { fetchHomeRecommendationsApi } from '../api/fetchHomeRecommendations'
import type { VideoSearchEntry } from '../types'

// ponytail: module cache, no TTL — the entry view remounts this hook when
// the transient container hands over to the stacked one; cache avoids a
// refetch. Session change (re-login) or app restart refetches.
let cachedEntries: VideoSearchEntry[] | null = null
// In-flight request shared across concurrent hook instances — the page
// mounts this hook twice (the shelf and the heading gate), and without a
// shared promise both would fetch in the same commit.
let inflight: Promise<VideoSearchEntry[]> | null = null

/**
 * Personalized recommendations for the search page's entry view.
 * Fetches once per session; failures degrade to an empty list so the
 * shelf just stays hidden (the backend already logs the failure).
 */
export function useHomeRecommendations() {
  // Why the live nav-API state and NOT the login slice's `session`:
  // Firefox-cookie logins never populate `session` (no session file is
  // written) but ARE logged in — `user.data.isLogin` is the app-wide
  // truth the AppBar and video cards already gate on.
  const isLoggedIn = useSelector((s: RootState) => s.user.data.isLogin)
  const [entries, setEntries] = useState<VideoSearchEntry[]>(
    () => cachedEntries ?? [],
  )
  const [loaded, setLoaded] = useState(() => cachedEntries !== null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!isLoggedIn || loaded) return
    let cancelled = false
    const request = (inflight ??= fetchHomeRecommendationsApi())
    request
      .then((e) => {
        // Written before the cancelled check so an instance that unmounts
        // mid-flight still seeds the cache for the next mount.
        cachedEntries = e
        if (!cancelled) {
          setEntries(e)
          setLoaded(true)
        }
      })
      .catch(() => {
        // Backend contract: no errors expected; a rejection (e.g. command
        // missing in an older bundle) just hides the shelf. Left uncached
        // so a later remount can retry.
        if (!cancelled) setLoaded(true)
      })
      .finally(() => {
        if (inflight === request) inflight = null
      })
    return () => {
      cancelled = true
    }
  }, [isLoggedIn, loaded])

  /**
   * Manual refresh (the shelf's update button): re-fetches and swaps in
   * the new list. An empty result — the backend's only failure shape, it
   * never errors — or a rejection keeps the previous entries, so a
   * failed refresh never wipes the shelf (and its button) off-screen.
   */
  const refresh = async () => {
    setRefreshing(true)
    try {
      const next = await fetchHomeRecommendationsApi()
      if (next.length === 0) return
      // Seed the module cache too: a remount during the transient →
      // stacked handover then shows the refreshed list, not the old one.
      cachedEntries = next
      setEntries(next)
    } catch {
      // Same degrade-not-error stance as the initial fetch above: keep
      // the old list (the backend logs the failure).
    } finally {
      setRefreshing(false)
    }
  }

  const showSkeleton = isLoggedIn && !loaded
  return {
    entries,
    showSkeleton,
    refreshing,
    refresh,
    /** Shelf presence: skeleton or loaded entries. The page gates the
     * popular grid's companion heading on this so the logged-out view
     * stays exactly as it was. */
    visible: showSkeleton || entries.length > 0,
  }
}
