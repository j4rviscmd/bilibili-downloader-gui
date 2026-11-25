import { useSelector } from '@/app/store'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useSettings } from '@/features/settings'
import type { ThemePreset } from '@/features/settings/type'
import { ThemePresetGrid } from '@/features/settings/ui/ThemePresetGrid'
import { cn } from '@/shared/lib/utils'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Mandatory one-time theme onboarding shown once the app is initialized
 * but no persisted themePreset exists — first runs, and pre-preset users
 * still on the legacy accentColor (their effective preset is preselected).
 * Confirming persists themePreset (and the picked light/dark mode), so
 * the dialog never appears again. There is intentionally no dismiss path:
 * the grid's first entry (Bilibili) IS "keep the current look".
 */
export function ThemeOnboardingDialog() {
  const { t } = useTranslation()
  const { saveByForm } = useSettings()
  const initiated = useSelector((state) => state.init.initiated)
  const settings = useSelector((state) => state.settings)

  const open = initiated && settings.themePreset === undefined

  const defaultPreset: ThemePreset =
    settings.accentColor === 'blue' ? 'bilibili-blue' : 'bilibili'
  const [picked, setPicked] = useState<ThemePreset | null>(null)
  const [darkOverride, setDarkOverride] = useState<boolean | null>(null)
  const preset = picked ?? defaultPreset
  const dark = darkOverride ?? settings.theme === 'dark'

  // Reset the local overrides whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setPicked(null)
      setDarkOverride(null)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby={undefined}
        className="sm:max-w-5xl"
      >
        <DialogTitle className="text-base font-semibold">
          {t('settings.themeOnboarding_title')}
        </DialogTitle>
        <p className="text-muted-foreground -mt-2 text-sm">
          {t('settings.themeOnboarding_subtitle')}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground text-xs">
            {t('settings.themePreset_label')}
          </span>
          <div className="border-input inline-flex overflow-hidden rounded-lg border text-sm">
            <button
              type="button"
              data-testid="theme-onboarding-mode-light"
              aria-pressed={!dark}
              onClick={() => setDarkOverride(false)}
              className={cn(
                'cursor-pointer px-4 py-1.5 transition-colors',
                !dark
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {t('settings.theme_light')}
            </button>
            <button
              type="button"
              data-testid="theme-onboarding-mode-dark"
              aria-pressed={dark}
              onClick={() => setDarkOverride(true)}
              className={cn(
                'cursor-pointer px-4 py-1.5 transition-colors',
                dark
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {t('settings.theme_dark')}
            </button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[300px_1fr]">
          <div className="pr-1">
            <ThemePresetGrid
              value={preset}
              onValueChange={setPicked}
              className="grid-cols-4"
            />
          </div>
          {/* Two-layer preview isolation: the outer div pins the full
              bilibili base tokens (in the previewed mode) so nothing can
              inherit from the app root; the inner div swaps in the selected
              preset — needed because the bilibili-blue blocks override only
              the brand vars — and carries the surface so the panel itself
              shows the preset's background. */}
          <div
            data-theme-preset="bilibili"
            className={dark ? 'dark' : undefined}
          >
            <div
              data-testid="theme-onboarding-preview"
              data-theme-preset={preset}
              className={cn(
                'border-border bg-background text-foreground rounded-xl border p-4',
                dark && 'dark',
              )}
            >
              <div className="text-muted-foreground mb-3 text-xs font-medium">
                {t('settings.themeOnboarding_preview')}
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
                <span className="bg-card rounded-md px-2.5 py-1.5 font-medium whitespace-nowrap">
                  {t('nav.search')}
                </span>
                <span className="text-muted-foreground px-2.5 py-1.5 whitespace-nowrap">
                  {t('nav.downloads')}
                </span>
                <span className="text-muted-foreground px-2.5 py-1.5 whitespace-nowrap">
                  {t('nav.favorite')}
                </span>
              </div>
              <div className="border-border bg-card mb-3 rounded-lg border p-3 text-xs">
                <div className="mb-1 font-semibold">
                  {t('settings.themeOnboarding_previewCardTitle')}
                </div>
                <div className="text-muted-foreground">
                  {t('settings.themeOnboarding_previewCardBody')}
                </div>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="bg-brand-strong text-brand-foreground shrink-0 cursor-pointer rounded-md px-3.5 py-1.5 text-xs whitespace-nowrap"
                >
                  {t('actions.download')}
                </button>
                <button
                  type="button"
                  className="border-input shrink-0 cursor-pointer rounded-md border bg-transparent px-3.5 py-1.5 text-xs whitespace-nowrap"
                >
                  {t('actions.cancel')}
                </button>
                <span className="text-brand-strong shrink-0 cursor-pointer text-xs whitespace-nowrap underline">
                  {t('settings.themeOnboarding_previewLink')}
                </span>
              </div>
              <input
                readOnly
                className="border-input bg-background w-full rounded-md border px-2.5 py-1.5 text-xs outline-none"
                placeholder={t('video.url_placeholder')}
              />
              <div className="text-destructive mt-2 text-xs">
                {t('settings.themeOnboarding_previewError')}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="theme-onboarding-cta"
            onClick={() => {
              void saveByForm(
                { themePreset: preset, theme: dark ? 'dark' : 'light' },
                true,
              )
            }}
            className="bg-brand-strong text-brand-foreground hover:bg-brand-strong/90 cursor-pointer rounded-md px-4 py-2 text-sm transition-colors"
          >
            {t('settings.themeOnboarding_cta')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
