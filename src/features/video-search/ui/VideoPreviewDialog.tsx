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
  const [url, setUrl] = useState<string | null>(null)
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
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!entry) return
    setUrl(null)
    setError(null)
    setMediaFailed(false)
    let cancelled = false
    fetchPreviewPlayUrl(entry.bvid)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved)
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
    if (!url || !video) return
    if (previewVolume !== undefined) video.volume = previewVolume
    video.muted = previewMuted ?? false
  }, [url, previewVolume, previewMuted])

  // Cancel an in-flight debounced save when the dialog unmounts
  // (clearTimeout on a null handle is a no-op).
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // volumechange fires on both volume slider and mute-toggle interactions
  // with the native controls — a single listener persists whichever moved.
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
          {url && !mediaFailed ? (
            <>
              <video
                ref={videoRef}
                onLoadStart={() => setBuffering(true)}
                // waiting covers seek-buffering while PLAYING; a seek
                // started while PAUSED fires no waiting (spec), so the
                // seeking/seeked pair closes that gap.
                onWaiting={() => setBuffering(true)}
                onSeeking={() => setBuffering(true)}
                onPlaying={() => setBuffering(false)}
                onCanPlay={() => setBuffering(false)}
                onSeeked={() => setBuffering(false)}
                onError={() => {
                  setBuffering(false)
                  setMediaFailed(true)
                }}
                onVolumeChange={handleVolumeChange}
                src={url}
                controls
                // Suppresses the Download item in the native (Chromium/
                // WebView2) media-controls overflow (⋮) menu; the dialog's
                // own download handoff below is the intended path.
                controlsList="nodownload"
                autoPlay
                playsInline
                className="h-full w-full"
              />
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
