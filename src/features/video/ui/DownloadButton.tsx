'use client'
import { useVideoInfo } from '@/features/video/hooks/useVideoInfo'
import { RippleButton } from '@/shared/animate-ui/buttons/ripple'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import type { RootState } from '@/app/store'

/**
 * Download button with validation tooltip.
 *
 * Displays a download button that is disabled until all validation passes.
 * Shows a tooltip with the reason why the button is disabled (invalid URL,
 * duplicate titles, no parts selected, etc.).
 * Also disabled when any download is in progress.
 *
 * @example
 * ```tsx
 * <DownloadButton />
 * ```
 */
function DownloadButton() {
  const {
    download,
    isForm1Valid,
    isForm2ValidAll,
    duplicateIndices,
    selectedCount,
  } = useVideoInfo()
  const { t } = useTranslation()

  // Check if any download is running or pending
  const hasActiveDownloads = useSelector((state: RootState) =>
    state.queue.some(
      (q) => q.status === 'running' || q.status === 'pending',
    ),
  )

  const disabled = !(isForm1Valid && isForm2ValidAll) || hasActiveDownloads
  let reason: string | null = null
  if (!isForm1Valid) reason = t('validation.video.url.invalid')
  else if (duplicateIndices.length > 0) reason = t('video.duplicate_titles')
  else if (selectedCount === 0) reason = t('video.no_parts_selected')
  else if (!isForm2ValidAll) reason = t('validation.video.title.required')
  else if (hasActiveDownloads) reason = t('video.download_in_progress')

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <RippleButton onClick={download} disabled={disabled}>
              {hasActiveDownloads
                ? t('video.downloading')
                : t('actions.download')}
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
