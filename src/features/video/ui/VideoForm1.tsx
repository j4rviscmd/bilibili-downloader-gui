import { useVideoInfo } from '@/features/video'
import { expandShortUrl } from '@/features/video/api/expandShortUrl'
import {
  buildVideoFormSchema1,
  formSchema1,
} from '@/features/video/lib/formSchema'
import { cn } from '@/shared/lib/utils'
import { selectHasActiveDownloads } from '@/shared/queue'
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
import { useSelector } from 'react-redux'
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

function VideoForm1() {
  const { input, onValid1, isFetching, isSilentFetching } = useVideoInfo()
  const { t } = useTranslation()
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const [lastFetchedUrl, setLastFetchedUrl] = useState<string>('')
  const [isExpanding, setIsExpanding] = useState(false)
  const [expandError, setExpandError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // URL of an in-flight silent fetch, so blur/Enter during the flight does
  // not fire a duplicate request.
  const silentInFlightRef = useRef<string | null>(null)

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
          setLastFetchedUrl(expandedUrl)
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
      if (!url || url === lastFetchedUrl || url === silentInFlightRef.current)
        return
      if (!schema1.safeParse({ url }).success) return

      silentInFlightRef.current = url
      try {
        const ok = await onValid1(url, { silent: true })
        if (ok) setLastFetchedUrl(url)
      } finally {
        // Conditional release: a newer silent fetch may already own the
        // slot (user resumed typing and paused on another URL) — only the
        // owner clears it.
        if (silentInFlightRef.current === url) silentInFlightRef.current = null
      }
    },
    [schema1, lastFetchedUrl, onValid1],
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

    // Skip submission for short URLs - they will be auto-expanded
    if (isShortUrl(trimmedUrl)) return

    // The silent auto-fetch already fetched (or is fetching) this URL
    if (
      trimmedUrl === lastFetchedUrl ||
      trimmedUrl === silentInFlightRef.current
    ) {
      return
    }
    setLastFetchedUrl(trimmedUrl)
    onValid1(trimmedUrl)
  }

  const placeholder = t('video.url_placeholder_example')

  /**
   * Clears the URL input field and resets validation state.
   */
  function handleClear(onChange: (value: string) => void): void {
    // Cancel the pending auto action (expand/silent fetch) so it cannot
    // fire for the just-cleared value
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    form.setValue('url', '', { shouldValidate: true })
    onChange('')
    setLastFetchedUrl('')
  }

  /**
   * Renders the appropriate icon for the URL input field.
   *
   * Shows a loading spinner when expanding short URL or fetching video info,
   * or a clear button when the input has a value.
   */
  function renderInputIcon(
    value: string,
    onChange: (value: string) => void,
  ): React.ReactNode {
    if (isFetching || isExpanding) {
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
        disabled={hasActiveDownloads}
        onClick={() => handleClear(onChange)}
        className={cn(
          'text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-2 size-8 -translate-y-1/2 rounded-full p-1 transition-colors',
          hasActiveDownloads && 'cursor-not-allowed opacity-50',
        )}
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
   * Skips submission for short URLs since they will be auto-expanded.
   */
  const handleFormBlur = useCallback(() => {
    const currentUrl = form.getValues('url').trim()
    // Skip form submission for short URLs - they will be auto-expanded
    if (isShortUrl(currentUrl)) return
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
                    autoComplete="url"
                    type="url"
                    required
                    placeholder={placeholder}
                    // Why: a silent auto-fetch must not lock the field — the user
                    // has to stay able to keep typing or correct the URL mid-flight.
                    // The stale-result guard in VideoInfoContext.tsx (discard when
                    // store input.url !== url) only works because this input stays
                    // enabled, so only an explicit submit's fetch may disable it.
                    disabled={
                      (isFetching && !isSilentFetching) ||
                      isExpanding ||
                      hasActiveDownloads
                    }
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
