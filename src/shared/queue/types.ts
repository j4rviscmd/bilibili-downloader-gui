/**
 * Type definitions for the download queue domain (issue #691).
 *
 * The queue is a session-scoped (non-persisted) serial download queue:
 * `/search` enqueues sessions, a React-external runner drains them FIFO,
 * and `/downloads` renders the drain state. Items are resolved by
 * `kind` + `videoId` + `cid` — the legacy `-p(\d+)$` downloadId regex
 * parsing is abolished (the downloadId FORMAT `{parentId}-p{n}` is kept
 * because progressSlice internalIds and the merge-fallback toast dedupe
 * depend on it).
 */

/**
 * Subtitle stream descriptor (backend DTO).
 *
 * Moved from `features/video/types.ts`: the queue payload snapshots
 * subtitle selections at enqueue time, so the DTO belongs to the queue
 * domain. `features/video/types.ts` re-exports it for compatibility.
 */
export type SubtitleInfo = {
  /** Language code (e.g., "zh-CN", "en") */
  lan: string
  /** Language display text (e.g., "中文（简体）") */
  lanDoc: string
  /** Subtitle URL (BCC JSON format) */
  subtitleUrl: string
  /** Whether this is an AI-generated subtitle */
  isAi: boolean
  /**
   * AI subtitle type: 0 = legacy AI subtitle, 1 = translated AI subtitle.
   * Undefined for manually created subtitles.
   */
  aiType?: number
}

/**
 * Subtitle embed configuration (backend DTO shape).
 *
 * Moved from `features/video/types.ts` together with {@linkcode SubtitleInfo}.
 */
export type SubtitleConfig = {
  /** Subtitle embed mode: 'soft' for soft-sub, 'hard' for hard-sub */
  mode: 'soft' | 'hard' | 'off'
  /** Selected subtitle language codes (for soft-sub, multiple allowed) */
  selectedLans: string[]
}

/**
 * Lifecycle state of a single {@linkcode QueueItem}.
 *
 * - `pending` - Enqueued but not yet started by the runner.
 * - `running` - Actively downloading.
 * - `cancelling` - User requested cancellation; awaiting backend confirmation.
 * - `cancelled` - Backend confirmed cancellation via the `download_cancelled` event.
 * - `done` - Download finished successfully.
 * - `error` - Download failed; see `errorMessage` for details.
 */
export type QueueItemStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'done'
  | 'error'

/** Subtitle options snapshot carried in a {@linkcode DownloadPartPayload}. */
export type DownloadSubtitleOptions = {
  mode: SubtitleConfig['mode']
  selectedLans: string[]
  /** Only the streams for the selected languages (filtered at enqueue time). */
  subtitles: SubtitleInfo[]
}

/**
 * Immutable snapshot of everything the backend `download_video` command
 * needs for one part, taken at enqueue time. Later edits to
 * `state.input.partInputs` (title, quality, …) must NOT affect an already
 * enqueued part — that is the core decoupling the queueing feature adds.
 */
export type DownloadPartPayload = {
  /** 'BV...' or 'av...' */
  videoId: string
  cid: number
  /** Trimmed output filename (without extension) */
  filename: string
  /** Video quality ID (e.g., 80 for 1080p), null for best available */
  quality: number | null
  /** Audio quality ID (e.g., 30216 for 64K), null for durl format */
  audioQuality: number | null
  /** Duration in seconds for merge progress calculation */
  durationSeconds: number
  /** Thumbnail URL for history */
  thumbnailUrl: string | null
  /** Page number (1-based) for multi-part videos */
  page: number | null
  /** Episode ID for bangumi content */
  epId: number | null
  /** Subtitle options (already filtered to the selected languages) */
  subtitle: DownloadSubtitleOptions | null
}

/**
 * Which download stages a part actually runs (issue #446). Computed from
 * the lazy-loaded quality shape at ENQUEUE time and snapshotted onto the
 * queue item — reading it lazily later would break the progress divisor
 * for background downloads whose part inputs no longer exist.
 */
export type ExpectedStages = {
  /** Audio stream download runs (false: silent source or durl muxed file) */
  audioStage: boolean
  /** ffmpeg merge/remux runs (false: durl saves bytes directly) */
  mergeStage: boolean
}

/**
 * Queue item: a download session (parent) or one part within it (part).
 */
export type QueueItem = {
  /**
   * Unique download identifier. Parent: `{videoId}-{uuid}`,
   * part: `{parentId}-p{n}`.
   * @constraint The `-p{n}` suffix format is load-bearing — progressSlice
   *   internalIds (`{downloadId}:{stage}`) and the merge-fallback toast
   *   dedupe rely on it. Never parse it back out; use `kind`/`partIndex`.
   */
  downloadId: string
  /** Parent = one enqueue of a video (one card on /downloads); part = one mp4. */
  kind: 'parent' | 'part'
  /** Set on part items; links them to their parent session. */
  parentId?: string
  /** Badge/dedup match key 1 (both kinds). */
  videoId: string
  /** Badge/dedup match key 2 (part items only). */
  cid?: number
  /** 1-based part number (part items only). */
  partIndex?: number
  /** Display title. Carried on the item so /downloads never reads state.input. */
  title: string
  thumbnailUrl?: string | null
  /** Current lifecycle status. */
  status?: QueueItemStatus
  /** Error message if status is 'error'. */
  errorMessage?: string
  /** Output file path (available after completion). */
  outputPath?: string
  /** Parent download start timestamp (ms since epoch). */
  startedAtMs?: number
  /** Parent download completion timestamp (ms since epoch). */
  completedAtMs?: number
  /** FIFO ordering key. */
  enqueuedAtMs: number
  /** Stage divisor snapshot (part items only). */
  expectedStages?: ExpectedStages
  /** Backend invocation snapshot (part items only). */
  payload?: DownloadPartPayload
}

/** One part of an {@linkcode EnqueueSessionPayload}. */
export type EnqueuePartSpec = {
  /** 1-based part number. */
  partIndex: number
  cid: number
  /** Trimmed filename/title for this part. */
  title: string
  thumbnailUrl: string | null
  /** Precomputed stage expectations (issue #446 — snapshotted, not lazy). */
  expectedStages: ExpectedStages
  payload: DownloadPartPayload
}

/** Payload of `enqueueSession`: one video plus every selected part. */
export type EnqueueSessionPayload = {
  videoId: string
  videoTitle: string
  parts: EnqueuePartSpec[]
}
