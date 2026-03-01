import { store } from '@/app/store'
import { videoApi } from '@/features/video'
import { zodResolver } from '@hookform/resolvers/zod'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { callGetCurrentLibPath } from '@/features/settings/api/settingApi'
import {
  buildSettingsFormSchema,
  formSchema,
} from '@/features/settings/dialog/formSchema'
import { languages } from '@/features/settings/language/languages'
import { DevOptions } from '@/features/settings/ui/DevOptions'
import { TitleReplacementSettings } from '@/features/settings/ui/TitleReplacementSettings'
import { UpdateCheckButton } from '@/features/settings/ui/UpdateCheckButton'
import { useSettings } from '@/features/settings/useSettings'
import {
  RadioGroup,
  RadioGroupItem,
} from '@/shared/animate-ui/radix/radio-group'
import { Button } from '@/shared/ui/button'
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
import { Label } from '@/shared/ui/label'
import { Separator } from '@/shared/ui/separator'
import { Switch } from '@/shared/ui/switch'

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
 */
function SettingsForm() {
  const { t } = useTranslation()
  const { settings, saveByForm, updateLanguage, updateLibPath } = useSettings()
  const [isUpdatingLibPath, setIsUpdatingLibPath] = useState(false)
  const [isUpdatingDlOutputPath, setIsUpdatingDlOutputPath] = useState(false)
  const [currentLibPath, setCurrentLibPath] = useState<string>('')

  useEffect(() => {
    const fetchCurrentLibPath = async () => {
      try {
        setCurrentLibPath(await callGetCurrentLibPath())
      } catch (error) {
        console.error('Failed to get current lib path:', error)
        setCurrentLibPath(t('settings.lib_path_error'))
      }
    }
    fetchCurrentLibPath()
  }, [settings.libPath, t])

  /**
   * Opens a directory selection dialog using Tauri's dialog plugin.
   *
   * @param titleKey - Translation key for the dialog title
   * @param defaultPath - Optional initial directory path
   * @returns Selected directory path or null if cancelled/error occurred
   */
  const openDirectoryDialog = async (
    titleKey: string,
    defaultPath?: string,
  ): Promise<string | null> => {
    try {
      return await open({
        directory: true,
        multiple: false,
        title: t(titleKey),
        defaultPath,
      })
    } catch (error) {
      console.error('Failed to open directory dialog:', error)
      return null
    }
  }

  /**
   * Handles library path selection via directory dialog.
   * Updates the library path setting after user selects a directory.
   */
  const handleLibPathChange = async () => {
    setIsUpdatingLibPath(true)
    try {
      const selected = await openDirectoryDialog(
        'settings.lib_path_dialog_title',
        currentLibPath,
      )
      if (selected) {
        await updateLibPath(selected)
      }
    } finally {
      setIsUpdatingLibPath(false)
    }
  }

  /**
   * Handles download output path selection via directory dialog.
   * Updates the form value and submits to save the new path.
   */
  const handleDlOutputPathChange = async () => {
    setIsUpdatingDlOutputPath(true)
    try {
      const selected = await openDirectoryDialog(
        'settings.output_dir_dialog_title',
        settings.dlOutputPath,
      )
      if (selected) {
        form.setValue('dlOutputPath', selected, {
          shouldDirty: true,
          shouldValidate: true,
        })
        form.handleSubmit(onSubmit)()
      }
    } finally {
      setIsUpdatingDlOutputPath(false)
    }
  }

  const schema = buildSettingsFormSchema(t)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      dlOutputPath: settings.dlOutputPath || '',
      language: settings.language || 'en',
    },
    mode: 'onBlur',
  })

  useEffect(() => {
    form.reset({
      dlOutputPath: settings.dlOutputPath || '',
      language: settings.language || 'en',
    })
  }, [form, settings.dlOutputPath, settings.language])

  /**
   * Handles form submission.
   * Detects changed fields and saves only those values.
   * Triggers language update if language setting changed.
   *
   * @param data - Form data matching the schema
   */
  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    const changedKeys = (['dlOutputPath', 'language'] as const).filter(
      (key) => data[key] !== settings[key],
    )

    if (changedKeys.length === 0) return

    if (data.language !== settings.language) {
      updateLanguage(data.language)
    }

    const changed = Object.fromEntries(
      changedKeys.map((key) => [key, data[key]]),
    ) as Partial<z.infer<typeof formSchema>>
    await saveByForm({ ...settings, ...changed })
  }

  /**
   * Handles language selection change.
   * Updates form value and immediately submits to apply new language.
   *
   * @param val - Selected language code
   */
  const handleLanguageChange = (val: string) => {
    form.setValue('language', val as z.infer<typeof formSchema>['language'], {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.handleSubmit(onSubmit)()
  }

  return (
    <Form {...form}>
      <FormDescription className="mb-4">
        {t('settings.auto_save_note')}
      </FormDescription>
      <form onSubmit={form.handleSubmit(onSubmit)} className="mx-1 space-y-4">
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
                  {languages.map((lang) => (
                    <div key={lang.id} className="flex items-center space-x-3">
                      <RadioGroupItem value={lang.id} id={`lang-${lang.id}`} />
                      <Label htmlFor={`lang-${lang.id}`}>{lang.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </FormControl>
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
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{t('settings.auto_rename_duplicates_label')}</Label>
            <p className="text-muted-foreground text-sm">
              {t('settings.auto_rename_duplicates_description')}
            </p>
          </div>
          <Switch
            checked={settings.autoRenameDuplicates ?? true}
            onCheckedChange={(checked) => {
              saveByForm({ ...settings, autoRenameDuplicates: checked })
              // Clear video cache so new setting applies on next fetch
              store.dispatch(videoApi.util.resetApiState())
            }}
          />
        </div>
        <Separator />
        <TitleReplacementSettings />
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
          <FormDescription>
            {t('settings.lib_path_description')}
          </FormDescription>
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>{t('settings.app_section_label')}</Label>
          <UpdateCheckButton />
        </div>
        <Separator />
        <DevOptions />
      </form>
    </Form>
  )
}

export default SettingsForm
