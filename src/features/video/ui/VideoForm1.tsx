import { useVideoInfo } from '@/features/video/hooks/useVideoInfo'
import {
  buildVideoFormSchema1,
  formSchema1,
} from '@/features/video/lib/formSchema'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { zodResolver } from '@hookform/resolvers/zod'
import { open } from '@tauri-apps/plugin-shell'
import { AlertTriangle } from 'lucide-react'
import { Info } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import type { RootState } from '@/app/store'
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
  const user = useSelector((state: RootState) => state.user)

  const schema1 = buildVideoFormSchema1(t)

  const form = useForm<z.infer<typeof formSchema1>>({
    resolver: zodResolver(schema1),
    defaultValues: {
      url: input.url || '',
    },
  })

  useEffect(() => {
    form.setValue('url', input.url, { shouldValidate: false })
  }, [form, input.url])

  function onSubmit(data: z.infer<typeof formSchema1>): void {
    onValid1(data.url)
  }

  const placeholder =
    t('video.url_placeholder_example') ||
    'e.g. https://www.bilibili.com/video/BV1xxxxxx'
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onBlur={form.handleSubmit(onSubmit)}
        className="space-y-3"
      >
        {/* Cookie Status Badge */}
        {!user.hasCookie && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <Info className="text-muted-foreground h-4 w-4" />
            <span className="text-muted-foreground">
              {t('user.cookie_missing')}
            </span>
          </div>
        )}

        {/* Quality Limit Warning for Non-logged-in Users */}
        {user.hasCookie && !user.data.isLogin && (
          <Alert variant="warning" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('video.quality_limited_title')}</AlertTitle>
            <AlertDescription>
              <p className="inline">
                {t('video.quality_limited_description')}
                {' '}
                <a
                  href="#"
                  className="underline font-medium hover:text-amber-700 dark:hover:text-amber-300"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    open('https://www.bilibili.com').catch(console.error)
                  }}
                >
                  {t('video.quality_limited_link')}
                </a>
                {t('video.quality_limited_link_suffix')}
              </p>
              <p className="text-xs">
                {t('video.quality_limited_restart_note')}
              </p>
            </AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('video.url_label')}</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    autoComplete="url"
                    type="url"
                    required
                    placeholder={placeholder}
                    disabled={isFetching}
                    {...field}
                  />
                  {isFetching && (
                    <div className="absolute top-1/2 right-3 -translate-y-1/2">
                      <Loader2 className="text-muted-foreground size-4 animate-spin" />
                    </div>
                  )}
                </div>
              </FormControl>
              <FormDescription>
                {isFetching
                  ? t('video.fetching_info')
                  : t('video.url_description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}

export default VideoForm1
