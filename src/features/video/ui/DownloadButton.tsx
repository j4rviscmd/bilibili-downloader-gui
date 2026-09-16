import { useVideoInfo } from '@/features/video'
import { RippleButton } from '@/shared/animate-ui/buttons/ripple'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { logger } from '@/shared/lib/logger'
import { startThumbnailFlight } from '@/shared/queue/ui/thumbnailFlight'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Download button component.
 *
 * Renders a download button that remains disabled until all validations
 * pass. When disabled, a tooltip explains the reason (invalid URL,
 * duplicate title, no parts selected, etc.).
 *
 * Downloads no longer disable this button while a session runs (issue
 * #691): clicking enqueues another session at the queue's tail. Parts
 * already active in the queue are auto-excluded at enqueue time.
 */
function DownloadButton() {
  const {
    download,
    isForm1Valid,
    isForm2ValidAll,
    duplicateIndices,
    selectedCount,
    input,
  } = useVideoInfo()
  const { t } = useTranslation()

  const disabled = !(isForm1Valid && isForm2ValidAll)

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      logger.info(
        `DownloadButton: Download clicked, selectedCount=${selectedCount}`,
      )
      // Eye guidance (issue #691 comment 3): launch the first selected
      // part's thumbnail toward the bottom bar as the session is enqueued.
      // MVP flies one representative thumbnail; the avatar group pops the
      // real per-session slots in as they land.
      const firstSelected = input.partInputs.find((pi) => pi.selected)
      startThumbnailFlight({
        url: firstSelected?.thumbnailUrl ?? null,
        rect: e.currentTarget.getBoundingClientRect(),
      })
      download()
    },
    [download, selectedCount, input.partInputs],
  )

  /**
   * Returns a localized explanation of why the download button is disabled,
   * or `null` if the button should be enabled.
   *
   * Checks conditions in priority order:
   * 1. Invalid URL (Step 1 form)
   * 2. Duplicate part titles
   * 3. No parts selected
   * 4. Missing subtitle language selection
   * 5. Invalid part title (Step 2 form)
   */
  function getDisabledReason(): string | null {
    if (!isForm1Valid) return t('validation.video.url.invalid')
    if (duplicateIndices.length > 0) return t('video.duplicate_titles')
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
            <RippleButton onClick={handleClick} disabled={disabled}>
              {t('actions.download')}
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
