import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { formSchema } from '@/shared/settings/dialog/formSchema'
import { useSettings } from '@/shared/settings/useSettings'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

// i18n t は useTranslation から取得
import { useTranslation } from 'react-i18next'

function SettingsForm() {
  const { t } = useTranslation()
  const { settings, saveByForm } = useSettings()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dlOutputPath: settings.dlOutputPath || '',
    },
    mode: 'onBlur',
  })

  // settings が外部で更新された際にフォームへ反映
  useEffect(() => {
    form.reset({
      dlOutputPath: settings.dlOutputPath || '',
    })
  }, [settings.dlOutputPath])

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    console.log(data.dlOutputPath, settings.dlOutputPath)
    if (data.dlOutputPath !== settings.dlOutputPath) {
      await saveByForm({
        ...settings,
        dlOutputPath: data.dlOutputPath,
      })
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onBlur={form.handleSubmit(onSubmit)}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="dlOutputPath"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t('settings.output_dir_label', '出力ディレクトリ')}
              </FormLabel>
              <FormControl>
                <Input
                  required
                  placeholder={t(
                    'settings.output_dir_placeholder',
                    '例: C\\\\Users\\\\you\\\\Downloads もしくは /Users/you/Downloads',
                  )}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {t(
                  'settings.output_dir_description',
                  '動画ファイルの保存先ディレクトリを入力してください。',
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}

export default SettingsForm
