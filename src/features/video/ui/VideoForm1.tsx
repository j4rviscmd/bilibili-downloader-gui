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
 * @example
 * ```tsx
 * <VideoForm1 />
 * ```
 */
function VideoForm1() {
  const { input, onValid1, isFetching } = useVideoInfo()
  const { t } = useTranslation()
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const [lastFetchedUrl, setLastFetchedUrl] = useState<string>('')
  const [isExpanding, setIsExpanding] = useState(false)
  const [expandError, setExpandError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schema1 = buildVideoFormSchema1(t)

  const form = useForm<z.infer<typeof formSchema1>>({
    resolver: zodResolver(schema1),
    defaultValues: {
      url: input.url || '',
    },
  })

  useEffect(() => {
    const trimmedUrl = input.url.trim()
    // 空文字の場合はバリデーションをスキップ（初期表示時のエラー防止）
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
   * Expands a b23.tv short URL with 500ms debounce.
   */
  const handleExpandShortUrl = useCallback(
    (url: string) => {
      // Clear previous debounce timer
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      // Debounce 500ms
      debounceRef.current = setTimeout(async () => {
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
      }, 500)
    },
    [form, t, lastFetchedUrl, onValid1],
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
   * Skips submission if expanding, URL unchanged, or short URL (will be auto-expanded).
   */
  function onSubmit(data: z.infer<typeof formSchema1>): void {
    // Skip submission while expanding short URL
    if (isExpanding) return

    const trimmedUrl = data.url.trim()

    // Skip submission for short URLs - they will be auto-expanded
    if (isShortUrl(trimmedUrl)) return

    if (trimmedUrl === lastFetchedUrl) return
    setLastFetchedUrl(trimmedUrl)
    onValid1(trimmedUrl)
  }

  const placeholder = t('video.url_placeholder_example')

  /**
   * Clears the URL input field and resets validation state.
   */
  function handleClear(onChange: (value: string) => void): void {
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

  /** Handles URL input change, triggering short URL expansion when detected. */
  const handleUrlChange = useCallback(
    (value: string, onChange: (value: string) => void) => {
      onChange(value)
      setExpandError(null)

      if (isShortUrl(value)) {
        handleExpandShortUrl(value)
      }
    },
    [isShortUrl, handleExpandShortUrl],
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
                    disabled={isFetching || isExpanding || hasActiveDownloads}
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
