'use client'
import { RippleButton } from '@/components/animate-ui/buttons/ripple'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/animate-ui/radix/tooltip'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { useTranslation } from 'react-i18next'

function DownloadButton() {
  const {
    download,
    isForm1Valid,
    isForm2ValidAll,
    duplicateIndices,
    selectedCount,
  } = useVideoInfo()
  const { t } = useTranslation()

  const disabled = !(isForm1Valid && isForm2ValidAll)
  let reason: string | null = null
  if (!isForm1Valid) reason = t('validation.video.url.invalid')
  else if (duplicateIndices.length > 0) reason = t('video.duplicate_titles')
  else if (selectedCount === 0) reason = t('video.no_parts_selected')
  else if (!isForm2ValidAll) reason = t('validation.video.title.required')

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={disabled && !!reason ? undefined : false}>
        <TooltipTrigger asChild>
          <span>
            <RippleButton onClick={download} disabled={disabled}>
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
