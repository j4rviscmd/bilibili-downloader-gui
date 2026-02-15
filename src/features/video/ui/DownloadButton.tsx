'use client'
import { useVideoInfo } from '@/features/video'
import { RippleButton } from '@/shared/animate-ui/buttons/ripple'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { selectHasActiveDownloads } from '@/shared/queue'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

/**
 * ダウンロードボタンコンポーネント。
 *
 * すべてのバリデーションが通過するまで無効化されたダウンロードボタンを表示します。
 * 無効な状態の場合、その理由（無効なURL、重複タイトル、パート未選択など）を
 * ツールチップで表示します。
 *
 * また、ダウンロード進行中も無効化されます。
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

  const hasActiveDownloads = useSelector(selectHasActiveDownloads)

  const disabled = !(isForm1Valid && isForm2ValidAll) || hasActiveDownloads

  function getDisabledReason(): string | null {
    if (!isForm1Valid) return t('validation.video.url.invalid')
    if (duplicateIndices.length > 0) return t('video.duplicate_titles')
    if (selectedCount === 0) return t('video.no_parts_selected')
    if (!isForm2ValidAll) return t('validation.video.title.required')
    if (hasActiveDownloads) return t('video.download_in_progress')
    return null
  }

  const reason = getDisabledReason()

  function getButtonText(): string {
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
