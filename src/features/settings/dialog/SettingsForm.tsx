import {
  buildSettingsFormSchema,
  formSchema,
} from '@/features/settings/dialog/formSchema'
import { useSettings } from '@/features/settings/useSettings'
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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

// i18n t は useTranslation から取得
import { languages } from '@/features/settings/language/languages'
import {
  RadioGroup,
  RadioGroupItem,
} from '@/shared/animate-ui/radix/radio-group'
import { cn } from '@/shared/lib/utils'
import { Label } from '@/shared/ui/label'
import { Separator } from '@/shared/ui/separator'
import { useTranslation } from 'react-i18next'

/**
 * Settings form component.
 *
 * Provides form inputs for configuring application settings:
 * - Language selection (radio buttons)
 * - Download output directory path (text input with validation)
 *
 * Changes are auto-saved when fields blur or when language is changed.
 * The form uses react-hook-form with Zod schema validation that supports
 * both Windows and POSIX path validation rules.
 *
 * @example
 * ```tsx
 * <SettingsForm />
 * ```
 */
function SettingsForm() {
  const { t } = useTranslation()
  const { settings, saveByForm, updateLanguage } = useSettings()

  // 言語変更ごとにスキーマを再生成 (バリデーションメッセージの多言語化)
  const schema = buildSettingsFormSchema(t)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      dlOutputPath: settings.dlOutputPath || '',
      language: settings.language || 'en',
    },
    mode: 'onBlur',
  })

  // settings が外部で更新された際にフォームへ反映
  useEffect(() => {
    form.reset({
      dlOutputPath: settings.dlOutputPath || '',
      language: settings.language || 'en',
    })
  }, [form, settings.dlOutputPath, settings.language])

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const changed: Partial<z.infer<typeof formSchema>> = {}
    if (data.dlOutputPath !== settings.dlOutputPath) {
      changed.dlOutputPath = data.dlOutputPath
    }
    if (data.language !== settings.language) {
      updateLanguage(data.language)
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
      <FormDescription>{t('settings.auto_save_note')}</FormDescription>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="language"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('settings.language_label')}</FormLabel>
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
              <FormLabel>{t('settings.output_dir_label')}</FormLabel>
              <FormControl>
                <Input
                  required
                  placeholder={t('settings.output_dir_placeholder')}
                  {...field}
                  onBlur={() => {
                    field.onBlur()
                    form.handleSubmit(onSubmit)()
                  }}
                />
              </FormControl>
              <FormDescription>
                {t('settings.output_dir_description')}
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
