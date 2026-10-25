import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { useVideoInfo } from '@/features/video'
import { RippleButton } from '@/shared/animate-ui/buttons/ripple'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { logger } from '@/shared/lib/logger'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

// Kbd's muted default vanishes on the brand-strong button fill; chips stay
// sub-label scale (h-3.5/9px) and faint (70% fg, 10% bg) under the label.
const kbdClassName =
  'bg-brand-foreground/10 text-brand-foreground/70 h-3.5 px-1 text-[9px]'

/**
 * Download button component.
 *
 * Renders a download button that remains disabled until all validations
 * pass. When disabled, a tooltip explains the reason (invalid URL,
 * no parts selected, etc.).
 *
 * Ctrl+Enter anywhere on the page fires the same download as clicking
 * (Ctrl is fixed on all platforms by design — no ⌘ fallback). The label
 * shows the shortcut as decorative Kbd chips.
 *
 * Downloads no longer disable this button while a session runs (issue
 * #691): clicking enqueues another session at the queue's tail. Parts
 * already active in the queue are auto-excluded at enqueue time.
 */
function DownloadButton() {
  const { download, isForm1Valid, isForm2ValidAll, selectedCount, input } =
    useVideoInfo()
  const { t } = useTranslation()

  const disabled = !(isForm1Valid && isForm2ValidAll)

  const handleClick = useCallback(() => {
    logger.info(
      `DownloadButton: Download clicked, selectedCount=${selectedCount}`,
    )
    download()
  }, [download, selectedCount, input.partInputs])

  // Ctrl+Enter anywhere on the page downloads, mirroring the click. The
  // listener lives and dies with this button's mount (video loaded +
  // parts selected), and skips the disabled state exactly like the click.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !event.ctrlKey) return
      // Why: runs before the disabled check so the chord is claimed even
      // when inactive — Enter's native default (a focused control) must
      // never double-fire the download (DownloadButton.test.tsx).
      event.preventDefault()
      if (!disabled) handleClick()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, handleClick])

  /**
   * Returns a localized explanation of why the download button is disabled,
   * or `null` if the button should be enabled.
   *
   * Checks conditions in priority order:
   * 1. Invalid URL (Step 1 form)
   * 2. No parts selected
   * 3. Missing subtitle language selection
   * 4. Invalid part title (Step 2 form)
   * Duplicate titles are NOT a reason: save-time collision avoidance
   * numbers same-name files automatically.
   */
  function getDisabledReason(): string | null {
    if (!isForm1Valid) return t('validation.video.url.invalid')
    if (selectedCount === 0) return t('video.no_parts_selected')
    if (!isForm2ValidAll) {
      const hasMissingSubtitle = input.partInputs
        .filter((pi) => pi.selected)
        .some(
          (pi) =>
            pi.subtitle?.mode !== 'off' && !pi.subtitle?.selectedLans?.length,
        )
      return hasMissingSubtitle
        ? t('video.subtitle_select_required')
        : t('validation.video.title.required')
    }
    return null
  }

  const reason = getDisabledReason()

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <RippleButton
              onClick={handleClick}
              disabled={disabled}
              className="bg-brand-strong text-brand-foreground hover:bg-brand-strong/90 h-auto flex-col gap-1"
              rippleClassName="bg-brand-foreground"
            >
              {t('actions.download')}
              {/* Decorative shortcut hint: aria-hidden keeps the button's
                  accessible name at the label alone (screen readers,
                  getByRole name matching). */}
              <KbdGroup
                aria-hidden="true"
                className="text-brand-foreground/70 text-[9px]"
              >
                <Kbd className={kbdClassName}>Ctrl</Kbd>+
                <Kbd className={kbdClassName}>Enter</Kbd>
              </KbdGroup>
            </RippleButton>
          </span>
        </TooltipTrigger>
        {disabled && reason && (
          <TooltipContent side="top" arrow>
            {reason}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  )
}

export default DownloadButton
