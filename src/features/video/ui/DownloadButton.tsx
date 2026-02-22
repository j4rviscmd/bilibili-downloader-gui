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
    input,
  } = useVideoInfo()
  const { t } = useTranslation()

  const hasActiveDownloads = useSelector(selectHasActiveDownloads)

  const disabled = !(isForm1Valid && isForm2ValidAll) || hasActiveDownloads

  /**
   * ダウンロードボタンが無効化されている理由を特定する。
   *
   * 以下の優先順位で理由を返す：
   * 1. URLが無効
   * 2. 重複タイトルが存在
   * 3. パートが選択されていない
   * 4. ダウンロード進行中
   * 5. フォーム2のバリデーションエラー（画質ロード中、画質未選択、字幕未選択、タイトル無効）
   *
   * @returns 無効化の理由（有効な場合は null）
   */
  function getDisabledReason(): string | null {
    if (!isForm1Valid) return t('validation.video.url.invalid')
    if (duplicateIndices.length > 0) return t('video.duplicate_titles')
    if (selectedCount === 0) return t('video.no_parts_selected')
    if (hasActiveDownloads) return t('video.download_in_progress')

    if (!isForm2ValidAll) {
      const selectedParts = input.partInputs.filter((pi) => pi.selected)

      if (selectedParts.some((pi) => pi.qualitiesLoading)) {
        return t('video.qualities_loading')
      }
      if (selectedParts.some((pi) => !pi.videoQuality || !pi.audioQuality)) {
        return t('validation.video.quality.required')
      }
      if (
        selectedParts.some(
          (pi) =>
            pi.subtitle?.mode !== 'off' && !pi.subtitle?.selectedLans?.length,
        )
      ) {
        return t('video.subtitle_select_required')
      }
      return t('validation.video.title.required')
    }

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
