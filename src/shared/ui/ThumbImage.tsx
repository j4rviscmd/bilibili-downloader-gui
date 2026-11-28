import { cn } from '@/shared/lib/utils'
import { ImageOff } from 'lucide-react'
import { useState, type ImgHTMLAttributes } from 'react'

type ThumbImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError' | 'onLoad'
> & {
  /** Remote image URL; a falsy value renders the placeholder directly. */
  src?: string | null
  /** Set false for tiny frames (avatars) where even the smallest icon is noise. */
  showIcon?: boolean
}

/**
 * Remote thumbnail with a unified fallback: a missing URL and a load
 * error (hdslb.com CDN 403s, offline) render the same muted ImageOff
 * placeholder instead of the webview's broken-image icon. Supersedes the
 * per-site `onError → '/placeholder.png'` hacks (that file never existed)
 * and the per-file local ThumbnailPlaceholder duplicates.
 */
export function ThumbImage({
  src,
  showIcon = true,
  className,
  ...imgProps
}: ThumbImageProps) {
  // Track the URL that failed, not a boolean: a changed src retries
  // immediately without an effect-driven reset.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [decodedSrc, setDecodedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) {
    return (
      <span
        className={cn(
          // Why: caller classes FIRST — cn/twMerge resolves the display
          // conflict in our favor: call-site 'block' (img baseline-gap
          // fix) must not defeat the placeholder's centering 'flex'.
          className,
          'bg-muted text-muted-foreground flex items-center justify-center',
          // Container sizing lets the icon track the frame height (queue
          // rows 16px → part/hero cards 28px) without a size prop.
          '[container-type:size]',
        )}
      >
        {showIcon && (
          <ImageOff aria-hidden className="size-[clamp(16px,32cqh,28px)]" />
        )}
      </span>
    )
  }

  return (
    <img
      src={src}
      className={cn(
        className,
        // Why: the webview paints a fresh image in visible row bands, so
        // the content is parked outside the box until decode() resolves.
        decodedSrc !== src &&
          'bg-brand/10 animate-pulse [object-position:-10000px_0]',
      )}
      // Why: reveal waits for decode(), not the `load` event — `load` fires
      // before decode+paint in the running WKWebView, so a load-triggered
      // reveal painted too early (see the parked-content Why above). A
      // rejected decode also reveals: onError owns the failure placeholder,
      // and parking would pulse forever.
      onLoad={(e) => {
        e.currentTarget.decode().then(
          () => setDecodedSrc(src),
          () => setDecodedSrc(src),
        )
      }}
      onError={() => setFailedSrc(src)}
      {...imgProps}
    />
  )
}
