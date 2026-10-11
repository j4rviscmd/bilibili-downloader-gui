import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { buildVideoUrl } from '@/features/video/lib/utils'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { logger } from '@/shared/lib/logger'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Download, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  closePreviewPlayer,
  openPreviewPlayer,
  pausePreviewPlayer,
  syncPreviewPlayer,
} from '../api/previewEmbed'
import type { VideoSearchEntry } from '../types'

/** Debounce for overlay syncs: the placeholder fires ResizeObserver
 * entries continuously while the dialog/window resizes, and every sync
 * is a set_position round-trip — coalesce a drag into occasional updates. */
const SYNC_DEBOUNCE_MS = 50

/**
 * Preview dialog for one search result, played by Bilibili's official
 * video page.
 *
 * The video area is a black placeholder: the backend positions a
 * frame-less child window (the real www.bilibili.com video page,
 * first-party so the injected session cookies apply) exactly over its
 * rect. Opening measures the rect after the dialog layout settles,
 * resizing keeps the overlay glued, closing removes the window.
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
  // The placeholder element as state (callback ref): the dialog's portal
  // can attach it a pass AFTER the effects run, and both overlay effects
  // need it — a plain ref would read null on the first pass.
  const [placeholderEl, setPlaceholderEl] = useState<HTMLDivElement | null>(
    null,
  )
  const [error, setError] = useState(false)
  // Latest onClose for the event listener (subscription is mount-once).
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Whether an entry has been previewed since mount — gates the close
  // call so an always-mounted dialog (entry starts null) does not fire a
  // pointless close command on every app start.
  const hadEntryRef = useRef(false)

  // Open/retarget the overlay once the dialog layout settles. Double
  // rAF waits out the open transition so the rect matches what the user
  // sees; a cancellation flag drops the pending open on rapid switches.
  useEffect(() => {
    if (!entry) {
      // Dialog closed: take the overlay down (also on unmount via the
      // mount-once effect below — this arm covers entry→null).
      if (hadEntryRef.current) {
        hadEntryRef.current = false
        void closePreviewPlayer().catch(() => {})
      }
      return
    }
    hadEntryRef.current = true
    setError(false)
    let cancelled = false
    const open = async () => {
      const el = placeholderEl
      if (!el) return
      const r = el.getBoundingClientRect()
      try {
        await openPreviewPlayer(entry.bvid, {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        })
      } catch {
        if (!cancelled) setError(true)
      }
    }
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled) void open()
      }),
    )
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [entry, placeholderEl])

  // Keep the overlay glued to the placeholder on dialog/window layout
  // changes. The backend follows main-window moves on its own.
  useEffect(() => {
    // Why: jsdom ships no ResizeObserver (see MockResizeObserver in
    // VideoPreviewDialog.test.tsx) — feature-detect so a missing observer
    // cannot stop the dialog from mounting; the overlay just stops following.
    if (!entry || !placeholderEl || typeof ResizeObserver === 'undefined')
      return
    const el = placeholderEl
    let timer: number | undefined
    // Why: shared by both event sources so they feed one debounce timer —
    // one window resize can fire the observer and the viewport listener
    // together, and separate timers would sync twice (see the coalescing
    // test in VideoPreviewDialog.test.tsx).
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        void syncPreviewPlayer({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }).catch(() => {})
      }, SYNC_DEBOUNCE_MS)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    // Why a viewport resize listener alongside the observer: ResizeObserver
    // reports size changes only. While the dialog's size caps
    // (max-w-7xl / max-h-[75vh]) hold the placeholder at a constant size,
    // a main-window resize still recenters the dialog — the overlay used to
    // stay glued to the stale rect and render offset from the dialog. The
    // viewport resize event covers that position-only change; pure window
    // moves keep the placeholder rect valid and stay with the backend's
    // Moved/Resized hook.
    window.addEventListener('resize', schedule)
    return () => {
      window.clearTimeout(timer)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [entry, placeholderEl])

  // The overlay window closed directly (Alt+F4) — close the dialog too.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen('preview-player-closed', () => onCloseRef.current()).then(
      (fn) => {
        unlisten = fn
      },
    )
    return () => {
      unlisten?.()
    }
  }, [])

  // Component unmount with a preview still open (page navigation while
  // the dialog is up): the entry→null arm above never runs.
  useEffect(
    () => () => {
      if (hadEntryRef.current) {
        hadEntryRef.current = false
        void closePreviewPlayer().catch(() => {})
      }
    },
    [],
  )

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
            windows. The black stand-in defines the rect the backend
            positions the player window over (see preview_embed.rs). */}
        <div className="relative aspect-video max-h-[75vh] w-full overflow-hidden rounded-md bg-black">
          <div ref={setPlaceholderEl} className="h-full w-full" />
          {error && (
            <div
              role="alert"
              className="text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-sm"
            >
              {t('videoSearch.previewOpenFailed')}
            </div>
          )}
        </div>

        {/* Preview actions. Download closes first (same handoff route
            as clicking the card body — the URL search page with the
            bvid preloaded — and the overlay dies with the dialog).
            "Open in browser" keeps the dialog: the overlay is only
            paused, so the browser tab does not double the audio. */}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!entry) return
              // Why: restores the pause-and-keep-open UX from #789; #821's overlay
              // rewrite lost the inline player's pause hook and regressed this
              // handoff to closing the whole dialog.
              // Fail soft: a lost overlay must not block the handoff.
              void pausePreviewPlayer().catch(() => {})
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
