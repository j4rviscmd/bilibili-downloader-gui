import { useVideoInfo } from '@/features/video'
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
import { useEffect, useState } from 'react'
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

  /**
   * Handles form submission with URL validation.
   *
   * Triggers video info fetch if the submitted URL differs from the
   * last fetched URL to prevent redundant API calls.
   *
   * @param data - The form data containing the URL field
   */
  function onSubmit(data: z.infer<typeof formSchema1>): void {
    const trimmedUrl = data.url.trim()
    if (trimmedUrl === lastFetchedUrl) return
    setLastFetchedUrl(trimmedUrl)
    onValid1(trimmedUrl)
  }

  const placeholder =
    t('video.url_placeholder_example') ||
    'e.g. https://www.bilibili.com/video/BV1xxxxxx'

  /**
   * Clears the URL input field and resets validation state.
   *
   * Resets the form value, calls the onChange handler, and clears
   * the last fetched URL to allow re-fetching the same URL.
   *
   * @param onChange - The field onChange callback from react-hook-form
   */
  function handleClear(onChange: (value: string) => void): void {
    form.setValue('url', '', { shouldValidate: true })
    onChange('')
    setLastFetchedUrl('')
  }

  /**
   * Renders the appropriate icon for the URL input field.
   *
   * Shows a loading spinner when fetching video info, or a clear button
   * when the input has a value. Returns null when the input is empty.
   *
   * @param value - The current URL input value
   * @param onChange - The field onChange callback from react-hook-form
   * @returns A React node containing either a loader, clear button, or null
   */
  function renderInputIcon(
    value: string,
    onChange: (value: string) => void,
  ): React.ReactNode {
    if (isFetching) {
      return (
        <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
      )
    }
    if (!value) return null

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

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onBlur={form.handleSubmit(onSubmit)}
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
                    disabled={isFetching || hasActiveDownloads}
                    {...field}
                  />
                  {renderInputIcon(field.value, field.onChange)}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}

export default VideoForm1
