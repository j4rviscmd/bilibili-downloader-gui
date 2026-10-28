import { useVideoInfo } from '@/features/video'
import { expandShortUrl } from '@/features/video/api/expandShortUrl'
import {
  buildVideoFormSchema1,
  formSchema1,
} from '@/features/video/lib/formSchema'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

/**
 * Form for video URL input (Step 1).
 *
 * Accepts a Bilibili video URL and validates it. On valid submission,
 * fetches video metadata from the backend. Shows a loading spinner while
 * fetching and displays validation errors inline.
 *
 * 500ms after the user pauses typing, an automatic action runs without
 * waiting for blur: b23.tv short URLs are expanded, and any other
 * schema-valid URL is fetched silently (no error feedback — only a
 * successful fetch reveals Step 2; explicit submit reports errors).
 *
 * @example
 * ```tsx
 * <VideoForm1 />
 * ```
 */

// Note: 500ms is carried over unchanged from the original b23.tv expansion
// debounce (commit 0e96a6f), so both auto actions keep the same input cadence.
/** Debounce delay (ms) shared by short-URL expansion and silent auto-fetch. */
const AUTO_ACTION_DELAY_MS = 500

function VideoForm1({
  onClearUrl,
}: {
  /** Called after a clear; the compact bar uses it to close the video. */
  onClearUrl?: () => void
} = {}) {
  const { input, onValid1, isFetching, isSilentFetching } = useVideoInfo()
  const { t } = useTranslation()
  const [lastFetchedUrl, setLastFetchedUrl] = useState<string>('')
  const [isExpanding, setIsExpanding] = useState(false)
  const [expandError, setExpandError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // URL of an in-flight silent fetch, so blur/Enter during the flight does
  // not fire a duplicate request.
  const silentInFlightRef = useRef<string | null>(null)
  // Last URL the user actually typed (trimmed). Blur auto-submit must only
  // commit typed input: a value synced from the store (RecentUrls re-fetch,
  // fetch CTA, ?url= effect) already ran its own onValid1, and re-submitting
  // one of those after a failure re-toasts the error on every unrelated
  // blur (settings click, another recent-URL click).
  const lastTypedUrlRef = useRef('')

  // Why a ref alongside the state value: the debounce timer's callback
  // closes over the value from the render that armed it. A timer armed just
  // before an explicit submit fires ~500ms later with a stale
  // lastFetchedUrl (''), letting a redundant silent fetch through. The ref
  // always holds the live value for the guard check.
  const lastFetchedUrlRef = useRef('')

  /** Records a fetched URL in both the state (render) and the ref (guards). */
  const markFetched = useCallback((url: string) => {
    lastFetchedUrlRef.current = url
    setLastFetchedUrl(url)
  }, [])

  const schema1 = buildVideoFormSchema1(t)

  const form = useForm<z.infer<typeof formSchema1>>({
    resolver: zodResolver(schema1),
    defaultValues: {
      url: input.url || '',
    },
  })

  useEffect(() => {
    const trimmedUrl = input.url.trim()
    // Skip validation for empty strings (prevent errors on initial render)
    form.setValue('url', trimmedUrl, { shouldValidate: trimmedUrl.length > 0 })
  }, [form, input.url])

  /** Returns true if the URL is a b23.tv short URL. */
  const isShortUrl = useCallback((url: string): boolean => {
    try {
      const { hostname } = new URL(url)
      return /^b23\.tv$/i.test(hostname)
    } catch {
      return false
    }
  }, [])

  /**
   * Expands a b23.tv short URL and fetches video info for the expanded
   * URL. Called after the input debounce; errors are user-visible
   * (inline expansion error / fetch toast).
   */
  const handleExpandShortUrl = useCallback(
    async (url: string) => {
      setIsExpanding(true)
      setExpandError(null)

      try {
        const expandedUrl = await expandShortUrl(url)
        // Update form value with expanded URL
        form.setValue('url', expandedUrl, { shouldValidate: true })
        // Trigger video info fetch with expanded URL
        if (expandedUrl !== lastFetchedUrl) {
          markFetched(expandedUrl)
          onValid1(expandedUrl)
        }
      } catch {
        setExpandError(t('validation.video.url.short_url_expand_failed'))
      } finally {
        setIsExpanding(false)
      }
    },
    [form, t, lastFetchedUrl, onValid1],
  )

  /**
   * Silently fetches video info for a schema-valid URL after the user
   * pauses typing. Invalid/incomplete URLs are ignored without feedback —
   * only explicit submit (Enter/blur) reports errors. On failure,
   * lastFetchedUrl stays unset so a later blur/Enter retries visibly.
   */
  const handleSilentFetch = useCallback(
    async (url: string) => {
      // Guard by the ref, not the lastFetchedUrl state: this runs from the
      // debounce timer's (possibly stale) closure — see the ref's block doc.
      // (Downloads no longer freeze the input — issue #691 — so an active
      // session no longer suppresses silent fetches.)
      if (
        !url ||
        url === lastFetchedUrlRef.current ||
        url === silentInFlightRef.current
      )
        return
      if (!schema1.safeParse({ url }).success) return

      silentInFlightRef.current = url
      try {
        const ok = await onValid1(url, { silent: true })
        if (ok) markFetched(url)
      } finally {
        // Conditional release: a newer silent fetch may already own the
        // slot (user resumed typing and paused on another URL) — only the
        // owner clears it.
        if (silentInFlightRef.current === url) silentInFlightRef.current = null
      }
    },
    [schema1, onValid1, markFetched],
  )

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  /**
   * Handles form submission with URL validation.
   * Skips submission if expanding, URL unchanged or silently fetching
   * in flight, or short URL (will be auto-expanded).
   */
  function onSubmit(data: z.infer<typeof formSchema1>): void {
    // Skip submission while expanding short URL
    if (isExpanding) return

    const trimmedUrl = data.url.trim()

    // Empty is valid by design (schema) but there is nothing to fetch.
    if (!trimmedUrl) return

    // Skip submission for short URLs - they will be auto-expanded
    if (isShortUrl(trimmedUrl)) return

    // The silent auto-fetch already fetched (or is fetching) this URL
    if (
      trimmedUrl === lastFetchedUrl ||
      trimmedUrl === silentInFlightRef.current
    ) {
      return
    }
    // An explicit submit commits this URL — a pending debounce timer (armed
    // by the typing that led here) must not re-fetch it afterwards.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    markFetched(trimmedUrl)
    onValid1(trimmedUrl)
  }

  const placeholder = t('video.url_placeholder_example')

  /**
   * Clears the URL input field and resets validation state.
   */
  function handleClear(onChange: (value: string) => void): void {
    // Cancel the pending auto action (expand/silent fetch) so it cannot
    // fire for the just-cleared value. clearTimeout no-ops for a spent id.
    clearTimeout(debounceRef.current ?? undefined)
    // Clearing is not a validation failure: skip validation and drop any
    // stale error, or the empty field would immediately show
    // "enter a valid URL" right after the user cleared it.
    form.setValue('url', '', { shouldValidate: false })
    form.clearErrors('url')
    onChange('')
    // The field no longer holds a typed value; blur must not submit.
    lastTypedUrlRef.current = ''
    markFetched('')
    onClearUrl?.()
  }

  /**
   * Renders the appropriate icon for the URL input field.
   *
   * Shows a loading spinner when expanding short URL or during a
   * BLOCKING fetch, or a clear button when the input has a value.
   */
  function renderInputIcon(
    value: string,
    onChange: (value: string) => void,
  ): React.ReactNode {
    // Spinner only for blocking states (explicit submit / expansion):
    // during a silent auto-fetch the input stays enabled by design, and
    // swapping the × for the spinner mid-press swallows the click — the
    // close action would silently no-op.
    if ((isFetching && !isSilentFetching) || isExpanding) {
      return (
        <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
      )
    }

    if (!value) {
      return null
    }

    return (
      <button
        type="button"
        data-testid="clear-url"
        aria-label={t('search.clear_url')}
        onClick={() => handleClear(onChange)}
        className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
      >
        <X className="size-4" />
      </button>
    )
  }

  /**
   * Handles URL input change. 500ms after the last keystroke, runs the
   * automatic action: expand a b23.tv short URL, or silently fetch any
   * other schema-valid URL.
   */
  const handleUrlChange = useCallback(
    (value: string, onChange: (value: string) => void) => {
      onChange(value)
      lastTypedUrlRef.current = value.trim()
      setExpandError(null)

      // Clear previous debounce timer
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        if (isShortUrl(value)) {
          void handleExpandShortUrl(value)
        } else {
          void handleSilentFetch(value.trim())
        }
      }, AUTO_ACTION_DELAY_MS)
    },
    [isShortUrl, handleExpandShortUrl, handleSilentFetch],
  )

  /**
   * Handles blur event on the form.
   * Skips submission for short URLs since they will be auto-expanded, and
   * for URLs the user did not type (store-synced values already ran their
   * own fetch — re-submitting a failed one re-toasts the error on every
   * unrelated blur).
   */
  const handleFormBlur = useCallback(() => {
    const currentUrl = form.getValues('url').trim()
    // Skip empty (nothing to validate or fetch) and short URLs (they
    // auto-expand) — blur alone must not surface an error.
    if (!currentUrl || isShortUrl(currentUrl)) return
    // Only commit typed input: programmatic values already went through
    // onValid1 on their own path.
    if (currentUrl !== lastTypedUrlRef.current) return
    form.handleSubmit(onSubmit)()
  }, [form, isShortUrl, onSubmit])

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onBlur={handleFormBlur}
        className="space-y-3"
      >
        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <div className="relative">
                  <Input
                    className="pr-10"
                    autoComplete="off"
                    type="url"
                    // Why: stable id so the hero command bar's visible
                    // <label htmlFor="url"> actually focuses this field.
                    id="url"
                    placeholder={placeholder}
                    // Why: a silent auto-fetch must not lock the field — the user
                    // has to stay able to keep typing or correct the URL mid-flight.
                    // The stale-result guard in VideoInfoContext.tsx (discard when
                    // store input.url !== url) only works because this input stays
                    // enabled, so only an explicit submit's fetch may disable it.
                    disabled={(isFetching && !isSilentFetching) || isExpanding}
                    value={field.value}
                    onChange={(e) =>
                      handleUrlChange(e.target.value, field.onChange)
                    }
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                  {renderInputIcon(field.value, field.onChange)}
                </div>
              </FormControl>
              {expandError ? (
                <p className="text-destructive text-sm">{expandError}</p>
              ) : (
                <FormMessage />
              )}
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}

export default VideoForm1
