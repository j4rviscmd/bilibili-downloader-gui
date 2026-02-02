import {
  buildSettingsFormSchema,
  formSchema,
} from '@/features/settings/dialog/formSchema'
import { useSettings } from '@/features/settings/useSettings'
import { callGetCurrentLibPath } from '@/features/settings/api/settingApi'
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
import { Button } from '@/shared/ui/button'
import { open } from '@tauri-apps/plugin-dialog'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
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
  const { settings, saveByForm, updateLanguage, updateLibPath } = useSettings()
  const [isUpdatingLibPath, setIsUpdatingLibPath] = useState(false)
  const [isUpdatingDlOutputPath, setIsUpdatingDlOutputPath] = useState(false)
  const [currentLibPath, setCurrentLibPath] = useState<string>('')

  // Calculate current lib path for display
  useEffect(() => {
    const fetchCurrentLibPath = async () => {
      try {
        const path = await callGetCurrentLibPath()
        setCurrentLibPath(path)
      } catch (error) {
        console.error('Failed to get current lib path:', error)
        setCurrentLibPath(t('settings.lib_path_error'))
      }
    }

    fetchCurrentLibPath()
  }, [settings.libPath, t])

  // Handle lib path change
  const handleLibPathChange = async () => {
    try {
      setIsUpdatingLibPath(true)
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.lib_path_dialog_title'),
        defaultPath: currentLibPath || undefined,
      })

      if (selected) {
        // Backend will append /lib to the selected path
        await updateLibPath(selected)
      }
    } catch (error) {
      console.error('Failed to open directory dialog:', error)
    } finally {
      setIsUpdatingLibPath(false)
    }
  }

  // Handle dl output path change
  const handleDlOutputPathChange = async () => {
    try {
      setIsUpdatingDlOutputPath(true)
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('settings.output_dir_dialog_title'),
        defaultPath: settings.dlOutputPath || undefined,
      })

      if (selected) {
        form.setValue('dlOutputPath', selected, {
          shouldDirty: true,
          shouldValidate: true,
        })
        form.handleSubmit(onSubmit)()
      }
    } catch (error) {
      console.error('Failed to open directory dialog:', error)
    } finally {
      setIsUpdatingDlOutputPath(false)
    }
  }

  // 言語変更ごとにスキーマを再生成 (バリデーションメッセージの多言語化)
  const schema = buildSettingsFormSchema(t)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      dlOutputPath: settings.dlOutputPath || '',
      language: settings.language || 'en',
      downloadSpeedThresholdMbps: settings.downloadSpeedThresholdMbps ?? 1.0,
    },
    mode: 'onBlur',
  })

  // settings が外部で更新された際にフォームへ反映
  useEffect(() => {
    form.reset({
      dlOutputPath: settings.dlOutputPath || '',
      language: settings.language || 'en',
      downloadSpeedThresholdMbps: settings.downloadSpeedThresholdMbps ?? 1.0,
    })
  }, [
    form,
    settings.dlOutputPath,
    settings.language,
    settings.downloadSpeedThresholdMbps,
  ])

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const changedKeys = (
      ['dlOutputPath', 'language', 'downloadSpeedThresholdMbps'] as const
    ).filter((key) => data[key] !== settings[key])

    if (changedKeys.length === 0) return

    if (data.language !== settings.language) {
      updateLanguage(data.language)
    }

    const changed = Object.fromEntries(
      changedKeys.map((key) => [key, data[key]]),
    ) as Partial<z.infer<typeof formSchema>>
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
      <FormDescription className="mb-4">{t('settings.auto_save_note')}</FormDescription>
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
              <div className="flex items-center gap-2">
                <FormControl>
                  <Input
                    readOnly
                    placeholder={t('settings.output_dir_placeholder')}
                    {...field}
                    className="flex-1"
                  />
                </FormControl>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDlOutputPathChange}
                  disabled={isUpdatingDlOutputPath}
                >
                  {t(
                    isUpdatingDlOutputPath
                      ? 'settings.output_dir_changing'
                      : 'settings.output_dir_button',
                  )}
                </Button>
              </div>
              <FormDescription>
                {t('settings.output_dir_description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Separator />
        <FormField
          control={form.control}
          name="downloadSpeedThresholdMbps"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('settings.speed_threshold_label')}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="100"
                  placeholder="1.0"
                  {...field}
                  value={field.value ?? 1.0}
                  onChange={(e) => {
                    const num = parseFloat(e.target.value)
                    field.onChange(isNaN(num) ? 1.0 : num)
                  }}
                  onBlur={() => {
                    field.onBlur()
                    form.handleSubmit(onSubmit)()
                  }}
                />
              </FormControl>
              <FormDescription>
                {t('settings.speed_threshold_description')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Separator />
        <div className="space-y-2">
          <Label>{t('settings.lib_path_label')}</Label>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={currentLibPath}
              placeholder={t('settings.lib_path_default')}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleLibPathChange}
              disabled={isUpdatingLibPath}
            >
              {t(
                isUpdatingLibPath
                  ? 'settings.lib_path_changing'
                  : 'settings.lib_path_button',
              )}
            </Button>
          </div>
          <FormDescription>{t('settings.lib_path_description')}</FormDescription>
        </div>
      </form>
    </Form>
  )
}

export default SettingsForm
