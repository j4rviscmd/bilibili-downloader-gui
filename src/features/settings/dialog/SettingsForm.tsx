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
   * Opens a native directory picker dialog.
   *
   * Uses Tauri's dialog plugin to show a platform-native directory
   * selection dialog. Returns the selected path as a string, or null if
   * the user cancels or an error occurs.
   *
   * @param titleKey - Translation key for the dialog title
   * @param defaultPath - Optional starting directory path
   * @returns Selected directory path, or null if cancelled/failed
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
        defaultPath: defaultPath || undefined,
      })
    } catch (error) {
      console.error('Failed to open directory dialog:', error)
      return null
    }
  }

  /**
   * Handles library path directory selection.
   *
   * Opens a directory picker dialog for selecting the FFmpeg library path.
   * If the user selects a directory, the path is updated via the settings
   * API and the local state is refreshed.
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
   * Handles download output directory selection.
   *
   * Opens a directory picker dialog for selecting where downloaded videos
   * are saved. If the user selects a directory, the form value is updated,
   * validated, and immediately submitted to persist the change.
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
   * Form submission handler that saves changed settings.
   *
   * Compares form data against current settings to identify which fields
   * have changed. If the language changed, triggers a language update
   * immediately. All changed values are then persisted via the settings API.
   *
   * @param data - Validated form data matching the settings schema
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
   *
   * Updates the language field value when a user selects a different
   * language from the radio group. Marks the form as dirty and triggers
   * immediate validation and submission to save the change.
   *
   * @param val - Selected language identifier (e.g., 'en', 'ja')
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
