import { useAppDispatch, useSelector } from '@/app/store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { callPatchSettings } from '@/features/settings/api/settingApi'
import { setSettings } from '@/features/settings/settingsSlice'
import { buildVideoUrl } from '@/features/video/lib/utils'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { logger } from '@/shared/lib/logger'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import CircleIndicator from '@/shared/ui/CircleIndicator'
import { Skeleton } from '@/shared/ui/skeleton'
import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import Hls from 'hls.js'
import { Download, ExternalLink } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  closePreviewSession,
  openPreviewSession,
  type PreviewSessionInfo,
} from '../api/previewSession'
import type { VideoSearchEntry } from '../types'

/** Debounce for persisting preview-player volume changes: the native
 * volume slider fires volumechange continuously while dragged, and each
 * patch_settings is a locked disk write — coalesce a drag into one save. */
const VOLUME_SAVE_DEBOUNCE_MS = 500

/**
 * Inline preview dialog for one search result.
 *
 * Opened per entry from a card's thumbnail play button. The backend remuxes
 * the video to a growing fMP4 HLS playlist via ffmpeg (see
 * `handlers/preview_hls.rs`); this dialog plays it through hls.js (MSE —
 * WebView2/Linux) or the webview's native HLS (WKWebView). Closing kills
 * the remux session. ERR::* codes map to i18n keys and anything else falls
 * back to the raw message with the prefix stripped (video-search page
 * convention).
 */
export function VideoPreviewDialog({
  entry,
  onClose,
}: {
  /** Entry to preview; `null` keeps the dialog closed. */
  entry: VideoSearchEntry | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const handleDownload = usePendingDownload()
  const dispatch = useAppDispatch()
  const previewVolume = useSelector((state) => state.settings.previewVolume)
  const previewMuted = useSelector((state) => state.settings.previewMuted)
  const [session, setSession] = useState<PreviewSessionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set when the video element or hls.js fatally fails after the session
  // resolved — shows the retry message instead of a dead black canvas.
  const [mediaFailed, setMediaFailed] = useState(false)
  // Generation progress 0-100 (null once finished/unknown): drives the
  // "generating" badge while ffmpeg is still ahead of the playhead.
  const [genPct, setGenPct] = useState<number | null>(null)
  // True between the <video> mounting and its first playable frame.
  const [buffering, setBuffering] = useState(false)
  // Windows WebView2 (Chromium) native media controls already render a
  // buffering spinner — the custom overlay would double it. macOS
  // WKWebView and Linux WebKitGTK ship none, so the custom one stays
  // there. Evaluated per render (not module level) so tests can stub the
  // UA before mounting.
  const nativeBufferingSpinner =
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  // WKWebView plays HLS natively; MSE-based hls.js covers WebView2/Linux.
  const [useNativeHls] = useState(() => !Hls.isSupported())
  const videoRef = useRef<HTMLVideoElement>(null)
  // Guards the one-shot auto-retry below; reset per entry change.
  const retriedRef = useRef(false)
  // Generation of the current entry's open cycle, bumped on every entry
  // change: a still-pending retry from the PREVIOUS entry must not write
  // its result over the new entry's (a boolean cancel flag alone races).
  const retryGenRef = useRef(0)
  // Live session mirror for event handlers/cleanup (state is stale inside
  // older closures); the ref is the source of truth for token ownership.
  const sessionInfoRef = useRef<PreviewSessionInfo | null>(null)
  // First `playing` of the current session applied the start-at-zero
  // correction (EVENT playlists make hls.js start near the edge).
  const startedRef = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)

  /** One-shot retry: closes the current session and opens a fresh one.
   * Returns false when the retry budget is spent (caller shows the error). */
  const retryOnce = useCallback((): boolean => {
    if (retriedRef.current || !entry) return false
    retriedRef.current = true
    const gen = retryGenRef.current
    const old = sessionInfoRef.current
    sessionInfoRef.current = null
    if (old) {
      void closePreviewSession(old.token).catch(() => {})
    }
    setSession(null)
    setMediaFailed(false)
    setError(null)
    // The fresh session's EVENT playlist starts near its own edge again,
    // so the start-at-zero correction must run once more.
    startedRef.current = false
    openPreviewSession(entry.bvid)
      .then((resolved) => {
        if (retryGenRef.current === gen) {
          sessionInfoRef.current = resolved
          setSession(resolved)
        }
      })
      .catch((e: unknown) => {
        if (retryGenRef.current === gen) setError(String(e))
      })
    return true
  }, [entry])

  useEffect(() => {
    if (!entry) return
    setSession(null)
    sessionInfoRef.current = null
    setError(null)
    setMediaFailed(false)
    setGenPct(null)
    setBuffering(true)
    retriedRef.current = false
    retryGenRef.current += 1
    startedRef.current = false
    let cancelled = false
    openPreviewSession(entry.bvid)
      .then((resolved) => {
        if (!cancelled) {
          sessionInfoRef.current = resolved
          setSession(resolved)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
      const token = sessionInfoRef.current?.token
      sessionInfoRef.current = null
      if (token) {
        void closePreviewSession(token).catch(() => {})
      }
    }
  }, [entry])

  // Generation progress / failure events from the backend remux session.
  useEffect(() => {
    if (!entry) return
    let unlistenProgress: (() => void) | undefined
    let unlistenCompleted: (() => void) | undefined
    let unlistenError: (() => void) | undefined
    void listen<{ token: string; currentSec: number }>(
      'preview-hls-progress',
      (event) => {
        const info = sessionInfoRef.current
        if (!info || event.payload.token !== info.token) return
        const pct = Math.min(
          100,
          (event.payload.currentSec / Math.max(1, info.cappedAtSec)) * 100,
        )
        setGenPct(pct >= 100 ? null : pct)
      },
    ).then((fn) => {
      unlistenProgress = fn
    })
    void listen<string>('preview-hls-completed', (event) => {
      if (sessionInfoRef.current?.token === event.payload) setGenPct(null)
    }).then((fn) => {
      unlistenCompleted = fn
    })
    // ffmpeg died (CDN/rotation exhaustion included): the playlist stops
    // growing, which hls.js reports as a non-fatal stall — without this
    // the dialog would sit on the buffering spinner forever. Same one-shot
    // retry as the player-level failures (stale tokens are ignored: a
    // closed session's error must not reopen anything).
    void listen<string>('preview-hls-error', (event) => {
      if (sessionInfoRef.current?.token !== event.payload) return
      if (!retryOnce()) setMediaFailed(true)
    }).then((fn) => {
      unlistenError = fn
    })
    return () => {
      unlistenProgress?.()
      unlistenCompleted?.()
      unlistenError?.()
    }
  }, [entry, retryOnce])

  // Session → player wiring: hls.js (MSE) or the native HLS element path.
  useEffect(() => {
    const video = videoRef.current
    if (!session || !video) return
    const src = convertFileSrc(session.playlist, 'stream')
    if (useNativeHls) {
      video.src = src
      return
    }
    const hls = new Hls({
      maxBufferLength: 30,
      // The playlist appears only after ffmpeg writes its first segment,
      // and a CDN rotation/backoff window can extend that to tens of
      // seconds. hls.js 1.x ignores the legacy manifestLoading* numbers —
      // the load POLICY governs retries, and its default errorRetry
      // budget (1 retry) went manifestLoadError-fatal ~1s after session
      // open (the bug behind the second verification round).
      manifestLoadPolicy: {
        default: {
          // Must exceed the backend's 25s playlist long-poll window.
          maxTimeToFirstByteMs: 30_000,
          maxLoadTimeMs: 60_000,
          timeoutRetry: {
            maxNumRetry: 4,
            retryDelayMs: 500,
            maxRetryDelayMs: 2_000,
          },
          errorRetry: {
            maxNumRetry: 42,
            retryDelayMs: 700,
            maxRetryDelayMs: 2_000,
          },
        },
      },
    })
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      logger.error(
        `VideoPreviewDialog: hls fatal ${data.type} ${data.details} playlist=${session.playlist}`,
      )
      if (!retryOnce()) setMediaFailed(true)
    })
    hls.loadSource(src)
    // Pin the control-bar total to the preview's fixed content length.
    // EVENT playlists report a GROWING duration (hls.js tracks the
    // playlist end), so the denominator stretched while ffmpeg generated
    // (user-reported). `overrides.duration` is hls.js's own hook for
    // exactly this (MediaAttachingData). Seeks past the generated edge
    // clamp to the seekable range like a DVR; the capped badge explains
    // why long videos end at cappedAtSec.
    hls.attachMedia({
      media: video,
      overrides: { duration: session.cappedAtSec },
    })
    return () => {
      hls.destroy()
    }
  }, [session, useNativeHls, retryOnce])

  // Restore last-used volume/muted from settings onto the freshly mounted
  // <video> (the element is recreated per dialog open, so native state
  // resets to 1.0). LAYOUT effect on purpose: volume cannot be passed as
  // a JSX prop, and Chromium-based webviews (Windows WebView2) sync their
  // controls synchronously, so the pre-paint apply fully hides the jump
  // there. WKWebView (macOS) still paints its slider at max and animates
  // down — its UA controls sync on the asynchronously dispatched
  // volumechange; accepted as a platform quirk after a measured
  // two-frame-hidden workaround failed to suppress it. Re-asserting store
  // values after our own debounced save round-trip is a no-op: assigning
  // an unchanged volume fires nothing.
  useLayoutEffect(() => {
    const video = videoRef.current
    if (!session || !video) return
    if (previewVolume !== undefined) video.volume = previewVolume
    video.muted = previewMuted ?? false
  }, [session, previewVolume, previewMuted])

  // Cancel an in-flight debounced save when the dialog unmounts
  // (clearTimeout on a null handle is a no-op).
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // volumechange fires on the video's native controls; the value persists
  // to settings (debounced, see VOLUME_SAVE_DEBOUNCE_MS).
  const handleVolumeChange = () => {
    const video = videoRef.current
    if (!video) return
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const patch = { previewVolume: video.volume, previewMuted: video.muted }
      dispatch(setSettings(patch))
      callPatchSettings(patch).catch((e) => {
        logger.error('VideoPreviewDialog: failed to persist preview volume', e)
      })
    }, VOLUME_SAVE_DEBOUNCE_MS)
  }

  // ERR::* codes → translated message; unmapped codes/raw strings fall
  // back to the raw message with the prefix stripped (video-search page
  // convention — see src/pages/video-search/index.tsx).
  // Why the video_not_found override: the global message ends with "check
  // the URL", which fits the URL-input page but not a search-result entry
  // — here the view API refused the video itself (deleted/private/region-
  // blocked while the search index still lists it), so the URL is fine.
  let errorText: string | null = null
  if (error) {
    const key = mapBackendError(error)
    errorText =
      key === 'video.video_not_found'
        ? t('videoSearch.previewVideoUnavailable')
        : error.includes('ERR::PREVIEW_CDN_UNAVAILABLE')
          ? t('videoSearch.previewCdnBusy')
          : error.includes('ERR::PREVIEW_FFMPEG_MISSING')
            ? t('videoSearch.previewFfmpegMissing')
            : key
              ? t(key)
              : error.replace(/^ERR::/, '')
  } else if (mediaFailed) {
    // Player failure has no ERR:: code — generic retry message.
    errorText = t('videoSearch.previewPlaybackError')
  }

  const capped = session !== null && session.durationSec > session.cappedAtSec

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/* Why: the base DialogContent caps at sm:max-w-lg (512px); a video
          preview wants viewport-proportional width with a hard ceiling —
          85vw up to 7xl (1280px). The sm: override is required because
          twMerge treats plain and sm: variants as separate utilities. */}
      <DialogContent className="w-[85vw] max-w-7xl sm:max-w-7xl">
        <DialogHeader>
          <DialogTitle className="line-clamp-1 pr-6">
            {entry?.title}
          </DialogTitle>
        </DialogHeader>
        {/* max-h keeps the 16:9 box inside short windows; 75vh lets the
            7xl box hit its full 16:9 height (~693px) on ≥924px-tall
            windows. <video> letterboxes (object-fit default) instead of
            overflowing on shorter ones. */}
        <div className="relative aspect-video max-h-[75vh] w-full overflow-hidden rounded-md bg-black">
          {session && !mediaFailed ? (
            <>
              {/* Why the stream:// playlist: the webview never touches the
                  CDN — the Rust relay feeds ffmpeg, and the generated
                  segments are served locally (see preview_hls.rs /
                  preview_stream.rs), which is why CDN failures cannot
                  kill this element. */}
              <video
                ref={videoRef}
                onLoadStart={() => setBuffering(true)}
                // waiting covers seek-buffering while PLAYING; a seek
                // started while PAUSED fires no waiting (spec), so the
                // seeking/seeked pair closes that gap.
                onWaiting={() => setBuffering(true)}
                onSeeking={() => setBuffering(true)}
                onPlaying={() => {
                  setBuffering(false)
                  // EVENT playlists make hls.js start near the generation
                  // edge; jump back to zero once per session (spike-
                  // verified behavior — see the design spec).
                  const video = videoRef.current
                  if (video && !startedRef.current) {
                    startedRef.current = true
                    if (video.currentTime > 1) video.currentTime = 0
                  }
                }}
                onCanPlay={() => setBuffering(false)}
                onSeeked={() => setBuffering(false)}
                onError={(e) => {
                  setBuffering(false)
                  // Why log + one-shot retry: the session resolved fine, so
                  // only the player boundary sees the failure — record it
                  // (MediaError code + playlist path) in app.log. Dead CDN
                  // draws are handled server-side by URL rotation, so a
                  // player-level failure is rare; one retry before showing
                  // the failure UI.
                  const el = e.currentTarget
                  logger.error(
                    `VideoPreviewDialog: media error code=${el.error?.code} msg=${el.error?.message} playlist=${session?.playlist}`,
                  )
                  if (!retriedRef.current) {
                    retryOnce()
                    return
                  }
                  setMediaFailed(true)
                }}
                onVolumeChange={handleVolumeChange}
                // Native-HLS branch: the effect assigns `src` directly (no
                // media-source attach); the hls.js branch ignores src.
                controls
                // Suppresses the Download item in the native (Chromium/
                // WebView2) media-controls overflow (⋮) menu; the dialog's
                // own download handoff below is the intended path.
                controlsList="nodownload"
                autoPlay
                playsInline
                className="h-full w-full"
              />
              {capped && (
                <span className="absolute top-2 left-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs text-white/90">
                  {t('videoSearch.previewCapped')}
                </span>
              )}
              {genPct !== null && (
                <span className="absolute top-2 right-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs text-white/90">
                  {t('videoSearch.previewGenerating', {
                    percent: Math.round(genPct),
                  })}
                </span>
              )}
              {/* Overlay only — pointer-events-none keeps the native
                  controls usable while buffering. Suppressed on Windows
                  (see nativeBufferingSpinner). */}
              {buffering && !nativeBufferingSpinner && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <CircleIndicator size="lg" className="text-white/90" />
                </div>
              )}
            </>
          ) : errorText ? (
            <div
              role="alert"
              className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm"
            >
              {errorText}
            </div>
          ) : (
            <Skeleton className="h-full w-full rounded-none" />
          )}
        </div>

        {/* Preview-to-download handoff: same route as clicking the card
            body (URL search page with the bvid preloaded), so both entry
            points behave identically. Closing first stops playback. */}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!entry) return
              // The browser starts the same video — pause the preview
              // so audio doesn't double.
              videoRef.current?.pause()
              openUrl(buildVideoUrl(entry.bvid, 1)).catch((e) => {
                logger.error(
                  'VideoPreviewDialog: failed to open video in browser',
                  e,
                )
              })
            }}
          >
            <ExternalLink aria-hidden />
            {t('videoSearch.previewOpenInBrowser')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (!entry) return
              onClose()
              handleDownload(entry.bvid, null, 1)
            }}
          >
            <Download aria-hidden />
            {t('videoSearch.previewDownload')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
