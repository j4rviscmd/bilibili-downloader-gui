import { store } from '@/app/store'
import {
  getLoginState,
  qrLogout,
  setLoginMethod as setLoginMethodApi,
  type LoginMethod,
  type Session,
} from '@/features/login'
import { useUser } from '@/features/user'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { videoApi } from '@/features/video'
import { logger } from '@/shared/lib/logger'
import { zodResolver } from '@hookform/resolvers/zod'
import { open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { z } from 'zod'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Slider } from '@/components/ui/slider'
import { callGetCurrentLibPath } from '@/features/settings/api/settingApi'
import {
  buildSettingsFormSchema,
  formSchema,
} from '@/features/settings/dialog/formSchema'
import { languages } from '@/features/settings/language/languages'
import {
  applyFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  parseFontSize,
} from '@/features/settings/lib/fontSize'
import type { FontSizePreset } from '@/features/settings/type'
import { DevOptions } from '@/features/settings/ui/DevOptions'
import { ReleaseNotesSection } from '@/features/settings/ui/ReleaseNotesSection'
import { TitleReplacementSettings } from '@/features/settings/ui/TitleReplacementSettings'
import { UpdateCheckButton } from '@/features/settings/ui/UpdateCheckButton'
import { useSettings } from '@/features/settings/useSettings'
import {
  RadioGroup,
  RadioGroupItem,
} from '@/shared/animate-ui/radix/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
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
import { Info } from 'lucide-react'

/**
 * Returns the login status display text key based on session, method, and
 * the live user state from the Bilibili API.
 *
 * Firefox logins never populate `session` (no encrypted session file is
 * written), so we fall back to the user info fetched from the nav API to
 * decide whether the user is actually logged in.
 *
 * @param session - QR session payload, or `null` when no QR session is
 *   stored. Ignored for the Firefox method.
 * @param loginMethod - The currently selected login method.
 * @param user - The user object from Redux, used to detect whether the
 *   Firefox cookie actually authenticates the user.
 * @returns An i18n key (`login.qrCodeLoggedIn`, `login.firefoxCookieLoggedIn`,
 *   or `login.notLoggedIn`) suitable for `t()`.
 */
function getLoginStatusText(
  session: Session | null,
  loginMethod: LoginMethod,
  user: User,
): string {
  if (loginMethod === 'firefox') {
    return user.hasCookie && user.data.isLogin
      ? 'login.firefoxCookieLoggedIn'
      : 'login.notLoggedIn'
  }
  if (session === null) return 'login.notLoggedIn'
  return 'login.qrCodeLoggedIn'
}

/**
 * Converts Session to User type for userSlice.
 *
 * When `session` is `null`, returns a minimal logged-out `User` object so
 * the rest of the UI can treat the two sources uniformly. The `mid` field
 * is parsed from `dedeUserId` and left `undefined` when the value is not a
 * valid integer, matching the shape returned by the user-info API.
 *
 * @param session - Session data from login state, or `null` for logged-out.
 * @returns User object compatible with userSlice.
 */
function sessionToUser(session: Session | null): User {
  if (!session) {
    return {
      code: 0,
      message: '',
      ttl: 0,
      data: {
        uname: '',
        isLogin: false,
        wbiImg: {
          imgUrl: '',
          subUrl: '',
        },
      },
      hasCookie: false,
    }
  }
  return {
    code: 0,
    message: '',
    ttl: 0,
    data: {
      mid: parseInt(session.dedeUserId, 10) || undefined,
      uname: session.uname,
      isLogin: true,
      wbiImg: {
        imgUrl: '',
        subUrl: '',
      },
    },
    hasCookie: true,
  }
}

/**
 * Settings form component.
 *
 * Renders the full application settings panel including language, theme,
 * font size, download output directory, login method, and developer
 * options. Most fields auto-save on blur via the shared `useSettings`
 * hook; only the download-output path and language flow through
 * `react-hook-form` so they can participate in change detection and
 * validation.
 *
 * @returns The settings form element wrapped in a `react-hook-form` `Form`.
 */
function SettingsForm() {
  const { t } = useTranslation()
  const { settings, saveByForm, updateLanguage, updateLibPath } = useSettings()
  const { user } = useUser()
  const [isUpdatingLibPath, setIsUpdatingLibPath] = useState(false)
  const [isUpdatingDlOutputPath, setIsUpdatingDlOutputPath] = useState(false)
  const [currentLibPath, setCurrentLibPath] = useState<string>('')
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('firefox')
  const [session, setSession] = useState<Session | null>(null)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)

  // Fetch login state on mount
  useEffect(() => {
    const fetchLoginState = async () => {
      try {
        const state = await getLoginState()
        setLoginMethod(state.method)
        setSession(state.session)
      } catch (error) {
        logger.error('Failed to get login state', error)
      }
    }
    fetchLoginState()
  }, [])

  useEffect(() => {
    const fetchCurrentLibPath = async () => {
      try {
        setCurrentLibPath(await callGetCurrentLibPath())
      } catch (error) {
        logger.error('Failed to get current lib path', error)
        setCurrentLibPath(t('settings.lib_path_error'))
      }
    }
    fetchCurrentLibPath()
  }, [settings.libPath, t])

  /**
   * Opens a directory selection dialog.
   *
   * Thin wrapper around the Tauri `open` dialog used to keep error
   * handling consistent across the library-path and output-path pickers.
   *
   * @param titleKey - i18n key used as the dialog title.
   * @param defaultPath - Optional path the dialog opens at.
   * @returns The selected path, or `null` if the user cancels or an error
   *   occurs.
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
      logger.error('Failed to open directory dialog', error)
      return null
    }
  }

  /** Handles library path selection. */
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

  /** Handles download output path selection. */
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

  /**
   * Refreshes local login state from the backend and syncs userSlice.
   *
   * Used after operations that change server-side session state (logout,
   * login-method switch) so the form and AppBar stay consistent.
   */
  const refreshLoginState = async () => {
    const state = await getLoginState()
    setLoginMethod(state.method)
    setSession(state.session)
    store.dispatch(setUser(sessionToUser(state.session)))
    return state
  }

  /** Handles QR logout with confirmation. */
  const handleLogout = async () => {
    try {
      await qrLogout()
      setShowLogoutDialog(false)
      toast.success(t('login.qrSessionDeleted'))

      // Get fresh login state and update UI smoothly
      const state = await refreshLoginState()

      if (state.session) {
        toast.info(t('login.usingFirefoxCookie'))
      }
    } catch (error) {
      logger.error('QR logout failed', error)
    }
  }

  /**
   * Switches the preferred login method.
   *
   * Persists the new method via `set_login_method` (the backend also clears any
   * QR session artifacts when switching to Firefox). A restart is required for
   * the change to take effect because the cookie cache is populated during the
   * init sequence.
   */
  const handleLoginMethodChange = async (value: string) => {
    const next = value as LoginMethod
    if (next === loginMethod) return
    try {
      await setLoginMethodApi(next)
      setLoginMethod(next)
      await refreshLoginState()
      toast.success(t('login.loginMethodChanged'))
      toast.info(t('login.restartRequired'))
    } catch (error) {
      logger.error('Failed to change login method', error)
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
   * Handles form submission, saving only changed fields.
   *
   * Compares the submitted values against the current settings and skips
   * the persistence call entirely when nothing changed. When the language
   * differs, `updateLanguage` is invoked separately so the i18n bundle is
   * reloaded immediately rather than waiting for the next render cycle.
   *
   * @param data - Validated form values for `dlOutputPath` and `language`.
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

  /** Handles language selection change with immediate submit. */
  const handleLanguageChange = (val: string) => {
    form.setValue('language', val as z.infer<typeof formSchema>['language'], {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.handleSubmit(onSubmit)()
  }

  const currentFontSize = parseFontSize(settings.fontSize)

  // Show the platform-native modifier in shortcut hints (Cmd on macOS,
  // Ctrl elsewhere). `userAgent` is used because `navigator.platform` is
  // deprecated.
  const isMac =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
  const shortcutModKey = isMac ? '⌘' : 'Ctrl'

  /**
   * Handles font size slider changes.
   *
   * Parses the raw slider value into a valid preset, applies it to the
   * document root, and persists the setting via the settings hook.
   *
   * @param value - Array of slider values (single-element from shadcn Slider).
   */
  const handleFontSizeChange = useCallback(
    (value: number[]) => {
      const size = parseFontSize(value[0]) as FontSizePreset
      applyFontSize(size)
      saveByForm({ ...settings, fontSize: size })
    },
    [settings, saveByForm],
  )

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
        <FormItem>
          <FormLabel>{t('settings.theme_label')}</FormLabel>
          <RadioGroup
            value={settings.theme ?? 'light'}
            onValueChange={(value) => {
              saveByForm({
                ...settings,
                theme: value as 'light' | 'dark',
              })
            }}
            className="flex gap-6"
          >
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="light" id="theme-light" />
              <Label htmlFor="theme-light">{t('settings.theme_light')}</Label>
            </div>
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="dark" id="theme-dark" />
              <Label htmlFor="theme-dark">{t('settings.theme_dark')}</Label>
            </div>
          </RadioGroup>
        </FormItem>
        <div className="space-y-3">
          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <Label>{t('settings.font_size_label')}</Label>
              <KbdGroup>
                <Kbd>{shortcutModKey}</Kbd>
                <Kbd>+/-</Kbd>
              </KbdGroup>
            </div>
            <p className="text-muted-foreground text-sm">
              {t('settings.font_size_description')}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Slider
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={[currentFontSize]}
              onValueChange={handleFontSizeChange}
              className="flex-1"
            />
            <span className="w-10 text-right text-sm tabular-nums">
              {currentFontSize}px
            </span>
          </div>
        </div>
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
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{t('settings.show_github_stars_label')}</Label>
            <p className="text-muted-foreground text-sm">
              {t('settings.show_github_stars_description')}
            </p>
          </div>
          <Switch
            checked={settings.showGithubStars ?? true}
            onCheckedChange={(checked) => {
              saveByForm({ ...settings, showGithubStars: checked })
            }}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{t('settings.skip_splash_animation_label')}</Label>
            <p className="text-muted-foreground text-sm">
              {t('settings.skip_splash_animation_description')}
            </p>
          </div>
          <Switch
            checked={settings.skipSplashAnimation ?? false}
            onCheckedChange={(checked) => {
              saveByForm({ ...settings, skipSplashAnimation: checked })
            }}
          />
        </div>
        <Separator />
        <div className="space-y-2">
          <div className="space-y-0.5">
            <Label>{t('settings.trim_mode_label')}</Label>
            <p className="text-muted-foreground text-sm">
              {t('settings.trim_mode_description')}
            </p>
          </div>
          <TooltipProvider>
            <RadioGroup
              value={settings.trimMode ?? 'copy'}
              onValueChange={(value) => {
                saveByForm({
                  ...settings,
                  trimMode: value as 'copy' | 'reencode',
                })
              }}
              className="grid grid-cols-2 gap-4"
            >
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="copy" id="trim-copy" />
                <Label
                  htmlFor="trim-copy"
                  className="flex items-center gap-1 whitespace-nowrap"
                >
                  {t('settings.trim_mode_copy')}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t('trim.warningKeyframe')}
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{t('trim.warningKeyframe')}</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="reencode" id="trim-reencode" />
                <Label
                  htmlFor="trim-reencode"
                  className="flex items-center gap-1 whitespace-nowrap"
                >
                  {t('settings.trim_mode_reencode')}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t('trim.warningReencode')}
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{t('trim.warningReencode')}</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
              </div>
            </RadioGroup>
          </TooltipProvider>
        </div>
        <Separator />
        <div className="space-y-2">
          <div className="space-y-0.5">
            <Label>{t('settings.audio_format_label')}</Label>
            <p className="text-muted-foreground text-sm">
              {t('settings.audio_format_description')}
            </p>
          </div>
          <RadioGroup
            value={settings.audioFormat ?? 'mp3'}
            onValueChange={(value) => {
              saveByForm({
                ...settings,
                audioFormat: value as 'mp3' | 'm4a',
              })
            }}
            className="grid grid-cols-2 gap-4"
          >
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="mp3" id="audio-mp3" />
              <Label htmlFor="audio-mp3">
                {t('settings.audio_format_mp3')}
              </Label>
            </div>
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="m4a" id="audio-m4a" />
              <Label htmlFor="audio-m4a">
                {t('settings.audio_format_m4a')}
              </Label>
            </div>
          </RadioGroup>
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>{t('settings.app_section_label')}</Label>
          <div className="flex w-full items-end gap-2">
            <UpdateCheckButton />
            <ReleaseNotesSection />
          </div>
        </div>
        <Separator />
        {/* Login Method Section */}
        <div className="space-y-3">
          <div className="space-y-0.5">
            <Label>{t('login.loginMethod')}</Label>
            <p className="text-muted-foreground text-sm">
              {t('login.loginMethodDescription')}
            </p>
          </div>
          <RadioGroup
            value={loginMethod}
            onValueChange={handleLoginMethodChange}
            className="flex gap-6"
          >
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="firefox" id="login-method-firefox" />
              <Label htmlFor="login-method-firefox">
                {t('login.firefoxCookie')}
              </Label>
            </div>
            <div className="flex items-center space-x-3">
              <RadioGroupItem value="qrCode" id="login-method-qrcode" />
              <Label htmlFor="login-method-qrcode">{t('login.qrCode')}</Label>
            </div>
          </RadioGroup>
        </div>
        <Separator />
        {/* Login Status Section */}
        <div className="space-y-3">
          <Label>{t('login.loginStatus')}</Label>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">
              {t(getLoginStatusText(session, loginMethod, user))}
            </span>
            {loginMethod === 'qrCode' && session && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowLogoutDialog(true)}
              >
                {t('login.logout')}
              </Button>
            )}
          </div>
        </div>
        <Separator />
        <DevOptions />

        {/* Logout Confirmation Dialog */}
        <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('login.logoutConfirmTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('login.logoutConfirmMessage')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('login.cancel')}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleLogout}>
                {t('login.logout')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </form>
    </Form>
  )
}

export default SettingsForm
