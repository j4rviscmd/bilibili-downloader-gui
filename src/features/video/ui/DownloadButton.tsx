import { useVideoInfo } from '@/features/video'
import { RippleButton } from '@/shared/animate-ui/buttons/ripple'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import {
  selectHasActiveDownloads,
  selectHasCancellingDownloads,
} from '@/shared/queue'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

/**
 * Download button component.
 *
 * Renders a download button that remains disabled until all validations pass.
 * When disabled, a tooltip explains the reason (invalid URL, duplicate title,
 * no parts selected, etc.).
 *
 * Also disabled while a download is in progress or being cancelled.
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

  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const hasCancellingDownloads = useSelector(selectHasCancellingDownloads)

  const disabled = !(isForm1Valid && isForm2ValidAll) || hasActiveDownloads

  /**
   * Returns a localized explanation of why the download button is disabled,
   * or `null` if the button should be enabled.
   *
   * Checks conditions in priority order:
   * 1. Invalid URL (Step 1 form)
   * 2. Duplicate part titles
   * 3. No parts selected
   * 4. Download being cancelled
   * 5. Active download in progress
   * 6. Missing subtitle language selection
   * 7. Invalid part title (Step 2 form)
   */
  function getDisabledReason(): string | null {
    if (!isForm1Valid) return t('validation.video.url.invalid')
    if (duplicateIndices.length > 0) return t('video.duplicate_titles')
    if (selectedCount === 0) return t('video.no_parts_selected')
    if (hasCancellingDownloads) return t('video.download_cancelling')
    if (hasActiveDownloads) return t('video.download_in_progress')
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

  /**
   * Returns the localized label for the download button based on the
   * current download state (cancelling, in progress, or idle).
   */
  function getButtonText(): string {
    if (hasCancellingDownloads) return t('video.download_cancelling')
    if (hasActiveDownloads) return t('video.downloading')
    return t('actions.download')
  }

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <RippleButton onClick={download} disabled={disabled}>
              {getButtonText()}
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
