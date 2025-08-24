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
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/animate-ui/radix/radio-group'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { languages } from '@/shared/settings/language/languages'
import { useTranslation } from 'react-i18next'

function SettingsForm() {
  const { t } = useTranslation()
  const { settings, saveByForm } = useSettings()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dlOutputPath: settings.dlOutputPath || '',
      language: settings.language || 'en',
    },
    mode: 'onBlur', // デフォルトは dlOutputPath 用。language は手動で onChange submit する。
  })

  // settings が外部で更新された際にフォームへ反映
  useEffect(() => {
    form.reset({
      dlOutputPath: settings.dlOutputPath || '',
      language: settings.language || 'en',
    })
  }, [settings.dlOutputPath, settings.language])

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const changed: Partial<z.infer<typeof formSchema>> = {}
    if (data.dlOutputPath !== settings.dlOutputPath) {
      changed.dlOutputPath = data.dlOutputPath
    }
    if (data.language !== settings.language) {
      changed.language = data.language
    }
    if (Object.keys(changed).length === 0) return
    await saveByForm({ ...settings, ...changed })
  }

  // language 変更時に即保存 (onChange トリガ)
  const handleLanguageChange = (val: string) => {
    form.setValue('language', val as z.infer<typeof formSchema>['language'], {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.handleSubmit(onSubmit)()
  }

  return (
    <Form {...form}>
      <FormDescription>変更は自動的に保存されます。</FormDescription>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="language"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('settings.output_dir_label', '言語')}</FormLabel>
              <FormControl>
                <RadioGroup
                  value={String(field.value)}
                  onValueChange={handleLanguageChange}
                >
                  {languages.map((lang) => {
                    const id = `lang-${lang.id}`
                    return (
                      <div
                        key={lang.id}
                        className={cn('flex items-center space-x-3')}
                      >
                        <RadioGroupItem value={lang.id} id={id} />
                        <Label htmlFor={id}>{lang.label}</Label>
                      </div>
                    )
                  })}
                </RadioGroup>
              </FormControl>
              <FormDescription></FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Separator />
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
                  onBlur={() => {
                    field.onBlur()
                    form.handleSubmit(onSubmit)()
                  }}
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
