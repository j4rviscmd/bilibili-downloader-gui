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
import { openUrl } from '@tauri-apps/plugin-opener'
import { Download, ExternalLink } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchPreviewPlayUrl } from '../api/previewPlayUrl'
import type { VideoSearchEntry } from '../types'

/** Debounce for persisting preview-player volume changes: the native
 * volume slider fires volumechange continuously while dragged, and each
 * patch_settings is a locked disk write — coalesce a drag into one save. */
const VOLUME_SAVE_DEBOUNCE_MS = 500

/**
 * Inline MP4 preview dialog for one search result.
 *
 * Opened per entry from a card's thumbnail play button. The URL resolves
 * lazily on open (skeleton while in flight); closing unmounts the
 * `<video>` element, which stops playback. ERR::* codes map to i18n keys
 * and anything else falls back to the raw message with the prefix
 * stripped (video-search page convention).
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
  // Resolved proxy paths for the DASH video track and (when present) its
  // separate audio track; the audio element is synced to the video master
  // clock below.
  const [play, setPlay] = useState<{
    video: string
    audio: string | null
  } | null>(null)
  // Cleared when the audio track fails to load (durl muxed previews have
  // none; a mid-session audio error drops to silent playback).
  const [audioAvailable, setAudioAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Set when the <video> element itself rejects the resolved URL (media
  // `error` event — e.g. a CDN fetch failure after the URL resolved fine).
  // Without this the dead element just sits on a black canvas with a play
  // button and no message.
  const [mediaFailed, setMediaFailed] = useState(false)
  // True between the <video> mounting and its first playable frame —
  // the native controls already render in a "playing" posture during
  // that window, so an explicit spinner keeps the loading state honest.
  const [buffering, setBuffering] = useState(false)
  // Windows WebView2 (Chromium) native media controls already render a
  // buffering spinner — the custom overlay would double it. macOS
  // WKWebView and Linux WebKitGTK ship none, so the custom one stays
  // there. userAgent per the GeneralSection convention
  // (navigator.platform is deprecated). Evaluated per render (not module
  // level) so tests can stub the UA before mounting.
  const nativeBufferingSpinner =
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  // Guards the one-shot auto-retry below; reset per entry change.
  const retriedRef = useRef(false)
  // Last known playback position — restored onto the retry-remounted
  // element so a mid-seek CDN failure doesn't restart the preview.
  const restoreTimeRef = useRef(0)
  // Generation of the current entry's resolution cycle, bumped on every
  // entry change: a still-pending one-shot retry from the PREVIOUS entry
  // must not write its result over the new entry's (a boolean cancel flag
  // alone races — the new effect resets it before the old promise
  // resolves).
  const retryGenRef = useRef(0)
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!entry) return
    setPlay(null)
    setError(null)
    setMediaFailed(false)
    setAudioAvailable(true)
    retriedRef.current = false
    retryGenRef.current += 1
    let cancelled = false
    fetchPreviewPlayUrl(entry.bvid)
      .then((resolved) => {
        if (!cancelled) setPlay(resolved)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [entry])

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
    const audio = audioRef.current
    if (!play || !video) return
    if (previewVolume !== undefined) video.volume = previewVolume
    video.muted = previewMuted ?? false
    if (audio) {
      audio.volume = previewVolume ?? 1
      audio.muted = previewMuted ?? false
    }
  }, [play, previewVolume, previewMuted])

  // Cancel an in-flight debounced save when the dialog unmounts
  // (clearTimeout on a null handle is a no-op).
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // volumechange fires on the muted video's native controls — the audio
  // element is the audible track, so it both carries the persisted
  // volume/mute and mirrors whatever the user dragged on the video.
  const handleVolumeChange = () => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!video) return
    if (audio) {
      audio.volume = video.volume
      audio.muted = video.muted
    }
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const patch = { previewVolume: video.volume, previewMuted: video.muted }
      dispatch(setSettings(patch))
      callPatchSettings(patch).catch((e) => {
        logger.error('VideoPreviewDialog: failed to persist preview volume', e)
      })
    }, VOLUME_SAVE_DEBOUNCE_MS)
  }

  // Dual-track sync: the video element is the master clock, the hidden
  // audio element follows. Webview media elements cannot be wired through
  // WebAudio across elements, so a drift-correct interval is the standard
  // approximation (0.3s tolerance ≈ perceptibility threshold for A/V
  // offset; 500ms poll keeps the correction cadence imperceptible).
  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!play?.audio || !video || !audio) return
    const onPlay = () => {
      audio.currentTime = video.currentTime
      void Promise.resolve(audio.play()).catch((err: unknown) => {
        // AbortError = pause() interrupted play() (rapid play/pause) —
        // not a dead track; the next video play retries. Anything else
        // (network/decode/policy) degrades to silent playback.
        if ((err as { name?: string } | null)?.name !== 'AbortError') {
          setAudioAvailable(false)
        }
      })
    }
    const onPause = () => audio.pause()
    // Why pause during seeking: a video seek fires a burst of range
    // requests; letting the audio element keep buffering in parallel
    // doubles that burst against the CDN's per-connection risk control
    // (measured 2026-10-10: seek-time connection resets). Frozen audio
    // resumes at the target position once the video lands.
    const onSeeking = () => audio.pause()
    const onSeeked = () => {
      audio.currentTime = video.currentTime
      if (!video.paused) {
        void Promise.resolve(audio.play()).catch(() => {})
      }
    }
    const drift = window.setInterval(() => {
      if (
        !video.seeking &&
        Math.abs(audio.currentTime - video.currentTime) > 0.3
      ) {
        audio.currentTime = video.currentTime
      }
    }, 500)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    return () => {
      window.clearInterval(drift)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      audio.pause()
    }
  }, [play])

  // ERR::* codes → translated message; unmapped codes/raw strings fall
  // back to the raw message with the prefix stripped (video-search page
  // convention — see src/pages/video-search/index.tsx).
  // Why the override: the global video_not_found message ends with "check
  // the URL", which fits the URL-input page but not a search-result entry
  // — here the view API refused the video itself (deleted/private/region-
  // blocked while the search index still lists it), so the URL is fine.
  let errorText: string | null = null
  if (error) {
    const key = mapBackendError(error)
    errorText =
      key === 'video.video_not_found'
        ? t('videoSearch.previewVideoUnavailable')
        : key
          ? t(key)
          : error.replace(/^ERR::/, '')
  } else if (mediaFailed) {
    // Media-element failure has no ERR:: code — generic retry message.
    errorText = t('videoSearch.previewPlaybackError')
  }

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
          {play && !mediaFailed ? (
            <>
              {/* Dual-track DASH: the video m4s carries no audio, so this
                  element is silent by itself and its native volume/mute
                  controls stay meaningful — they drive the hidden <audio>
                  below (synced by the effect above). Muxed durl previews
                  have no audio element and the muted badge explains the
                  silence. */}
              <video
                ref={videoRef}
                onLoadStart={() => setBuffering(true)}
                // waiting covers seek-buffering while PLAYING; a seek
                // started while PAUSED fires no waiting (spec), so the
                // seeking/seeked pair closes that gap.
                onWaiting={() => setBuffering(true)}
                onSeeking={() => setBuffering(true)}
                onPlaying={() => setBuffering(false)}
                onCanPlay={() => {
                  setBuffering(false)
                  // Retry remount: jump back to where the user was (only
                  // meaningful once; clear so normal canplay events are
                  // no-ops).
                  const video = videoRef.current
                  if (video && restoreTimeRef.current > 0) {
                    video.currentTime = restoreTimeRef.current
                    restoreTimeRef.current = 0
                  }
                }}
                onSeeked={() => setBuffering(false)}
                onTimeUpdate={(e) => {
                  // Playback position snapshot for the error-retry remount:
                  // rapid re-seeks on huge DASH files can trip a CDN window
                  // failure the demuxer treats as fatal; the retry below
                  // rebuilds the element and this restores where the user
                  // was instead of restarting from zero.
                  restoreTimeRef.current = e.currentTarget.currentTime
                }}
                onError={(e) => {
                  setBuffering(false)
                  // Why log + one-shot retry: the proxy + BE resolved this
                  // fine, so the media element is the only boundary that
                  // sees the failure — without recording MediaError code +
                  // preview path here, intermittent failures leave no
                  // trace in app.log. Some CDN draws are dead edges (206
                  // headers, zero bytes — measured 2026-10-09); a single
                  // re-resolve usually draws a healthy edge, so retry once
                  // before showing the failure UI.
                  const el = e.currentTarget
                  logger.error(
                    `VideoPreviewDialog: media error code=${el.error?.code} msg=${el.error?.message} path=${play.video}`,
                  )
                  if (!retriedRef.current && entry) {
                    retriedRef.current = true
                    // Snapshot the generation: a resolution landing after
                    // the entry switched (generation bumped) is stale and
                    // must be dropped.
                    const gen = retryGenRef.current
                    setPlay(null)
                    setMediaFailed(false)
                    fetchPreviewPlayUrl(entry.bvid)
                      .then((resolved) => {
                        if (retryGenRef.current === gen) setPlay(resolved)
                      })
                      .catch((err: unknown) => {
                        if (retryGenRef.current === gen) setError(String(err))
                      })
                    return
                  }
                  setMediaFailed(true)
                }}
                onVolumeChange={handleVolumeChange}
                // Why the proxy: direct CDN playback is blocked by hotlink
                // heuristics and QUIC stalls (see previewPlayUrl.ts); the
                // stream:// protocol relays Range requests through reqwest.
                src={convertFileSrc(play.video, 'stream')}
                controls
                // Suppresses the Download item in the native (Chromium/
                // WebView2) media-controls overflow (⋮) menu; the dialog's
                // own download handoff below is the intended path.
                controlsList="nodownload"
                autoPlay
                playsInline
                className="h-full w-full"
              />
              {play.audio && audioAvailable && (
                <audio
                  ref={audioRef}
                  src={convertFileSrc(play.audio, 'stream')}
                  // A failed audio track degrades to silent playback rather
                  // than killing the preview (the video lane is the
                  // user's primary signal).
                  onError={() => {
                    logger.error(
                      `VideoPreviewDialog: audio track error path=${play.audio}`,
                    )
                    setAudioAvailable(false)
                  }}
                  hidden
                />
              )}
              {!play.audio && (
                <span className="absolute top-2 left-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs text-white/90">
                  {t('videoSearch.previewMuted')}
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
