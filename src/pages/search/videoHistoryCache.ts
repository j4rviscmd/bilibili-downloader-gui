import type { Input, Video } from '@/features/video'

/**
 * In-memory snapshot of one fetched video's page state, keyed by the
 * input URL that loaded it.
 *
 * Both slices are immutable Redux state, so a snapshot just holds
 * references — no copying. Memory cost is accepted by design (one entry
 * per fetched URL per app session, unbounded by decision). Dynamic keys
 * and per-fetch insertion are why this is a Map, not a Record.
 */
export type FetchedVideoSnapshot = {
  video: Video
  input: Input
}

/**
 * Snapshot store for back/forward navigation on the search page
 * (empty page ⇄ each fetched video). The page mirrors the loaded
 * video + input state into it continuously, so an entry always holds
 * the latest part selections, filenames and resolved-quality info.
 */
export const videoSnapshots = new Map<string, FetchedVideoSnapshot>()
