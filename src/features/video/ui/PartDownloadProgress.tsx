import { IconButton } from '@/components/animate-ui/components/buttons/icon'
import { CircleX } from '@/components/animate-ui/icons/circle-x'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import type { Progress } from '@/shared/ui/Progress'
import { Button } from '@/shared/ui/button'
import { invoke } from '@tauri-apps/api/core'
import { CheckCircle2, Download, FolderOpen, RotateCcw } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { PartDownloadStatus } from '../hooks/usePartDownloadStatus'

const MIN_HEIGHT = 'min-h-[33px]'

/**
 * 転送速度を人間が読みやすい単位でフォーマットします。
 *
 * キロバイト/秒を、大きさに応じて KB/s または MB/s に変換します。
 *
 * @param kb - 転送速度（キロバイト/秒）
 * @returns 単位付きのフォーマットされた文字列（例: "500KB/s", "2.5MB/s"）
 */
function formatTransferRate(kb: number): string {
  if (kb < 1000) {
    return `${kb.toFixed(0)}KB/s`
  }
  return `${(kb / 1024).toFixed(1)}MB/s`
}

/**
 * ステージ進捗表示用の props。
 */
type StageProgressProps = {
  icon: string
  labelKey: string
  progressEntries: Progress[]
  stageName: string
  t: (key: string) => string
  waitingLabel?: string
}

/**
 * ステージアイコン用のツールチップラッパー。
 *
 * ステージラベルをホバーツールチップで表示する絵文字アイコンを表示します。
 * アクティブなステージを強調するために、オプションで中太字を適用します。
 */
function StageIcon({
  icon,
  label,
  fontWeight,
}: {
  icon: string
  label: string
  fontWeight?: 'medium'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`cursor-help ${fontWeight === 'medium' ? 'font-medium' : ''}`}
          aria-label={label}
        >
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" arrow>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * 単一のダウンロードステージの進捗表示を描画します。
 *
 * 待機状態（アイコンのみ）またはアクティブな進捗（アイコン + パーセンテージ + 速度 + ファイルサイズ）のいずれかを表示します。
 */
function StageProgress({
  icon,
  labelKey,
  progressEntries,
  stageName,
  t,
  waitingLabel,
}: StageProgressProps) {
  const progress = progressEntries.find((p) => p.stage === stageName)
  const stageLabel = t(labelKey)

  if (!progress) {
    return (
      <div
        className={`flex ${MIN_HEIGHT} items-center`}
        aria-label={`${stageLabel}: ${waitingLabel ?? t('video.stage_waiting')}`}
      >
        <StageIcon icon={icon} label={stageLabel} />
      </div>
    )
  }

  return (
    <div className={`flex ${MIN_HEIGHT} items-center gap-1`}>
      <StageIcon icon={icon} label={stageLabel} fontWeight="medium" />
      <span>{progress.percentage.toFixed(0)}%</span>
      <span>{formatTransferRate(progress.transferRate || 0)}</span>
      {progress.filesize != null && (
        <span>
          {progress.downloaded?.toFixed(1) ?? '0'}mb/
          {progress.filesize.toFixed(1)}mb
        </span>
      )}
    </div>
  )
}

/**
 * マージステージ進捗表示用の props。
 */
type MergeStageProgressProps = {
  progressEntries: Progress[]
  t: (key: string) => string
}

/**
 * マージステージの進捗表示を描画します。
 *
 * マージステージには、音声/動画の完了状態に基づいた特殊な条件ロジックがあります：
 * - **アクティブなマージ**: マージが進行中の場合にパーセンテージを表示
 * - **マージ中状態**: 音声と動画の両方が完了しているが、マージ進捗がまだない場合に「マージ中」ステータスを表示
 * - **待機状態**: 音声または動画がまだダウンロード中の場合に「待機中」ステータスを表示
 * - **非表示**: 関連する進捗がない場合は null を返す
 */
function MergeStageProgress({ progressEntries, t }: MergeStageProgressProps) {
  const mergeProgress = progressEntries.find((p) => p.stage === 'merge')
  const audioProgress = progressEntries.find((p) => p.stage === 'audio')
  const videoProgress = progressEntries.find((p) => p.stage === 'video')
  const mergeLabel = t('video.stage_merge')

  // Active merge with percentage
  if (mergeProgress) {
    return (
      <div
        className={`flex ${MIN_HEIGHT} items-center gap-1`}
        aria-label={`${mergeLabel}: ${mergeProgress.percentage.toFixed(0)}%`}
      >
        <StageIcon icon="🔄" label={mergeLabel} fontWeight="medium" />
        <span className="font-medium"> {mergeLabel}</span>
        <span>{mergeProgress.percentage.toFixed(0)}%</span>
      </div>
    )
  }

  const audioComplete = (audioProgress?.percentage ?? 0) >= 100
  const videoComplete = (videoProgress?.percentage ?? 0) >= 100

  // Both complete - merging state
  if (audioComplete && videoComplete) {
    return (
      <div
        className={`flex ${MIN_HEIGHT} items-center gap-1`}
        aria-label={`${mergeLabel}: ${t('video.stage_merging')}`}
      >
        <StageIcon icon="🔄" label={mergeLabel} fontWeight="medium" />
        <span className="font-medium"> {mergeLabel}</span>
        <span>{t('video.stage_merging')}</span>
      </div>
    )
  }

  // Audio or video in progress - waiting state
  if (audioProgress || videoProgress) {
    return (
      <div
        className={`flex ${MIN_HEIGHT} items-center`}
        aria-label={`${mergeLabel}: ${t('video.stage_waiting')}`}
      >
        <StageIcon icon="🔄" label={mergeLabel} />
        <span>
          {mergeLabel}: {t('video.stage_waiting')}
        </span>
      </div>
    )
  }

  return null
}

type Props = {
  status: PartDownloadStatus
  isWaitingForTurn?: boolean
  onRedownload: () => void
  onRetry: () => void
  onCancel?: () => void
}

/**
 * 動画パートのダウンロード進捗を表示するコンポーネント。
 *
 * 以下の状態を表示します：
 * - 保留中: グレー表示のプログレスバーと「待機中...」およびキャンセルボタン
 * - 実行中: パーセンテージ、速度、残り時間、キャンセルボタンを含むプログレスバー
 * - 完了: 緑色のチェックマークとアクションボタン（ファイル/フォルダを開く、再ダウンロード）
 * - エラー: エラーメッセージとリトライボタン
 */
export function PartDownloadProgress({
  status,
  isWaitingForTurn = false,
  onRedownload,
  onRetry,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  const {
    isPending,
    isDownloading,
    isComplete,
    hasError,
    errorMessage,
    outputPath,
    progressEntries,
    isCancelling,
    isCancelled,
  } = status

  // Check if currently in merge stage (not cancellable)
  const isInMergeStage = progressEntries.some(
    (p) => p.stage === 'merge' && !p.isComplete,
  )

  // Can cancel if pending/downloading and not in merge stage
  const canCancel =
    (isPending || isDownloading) && !isInMergeStage && onCancel

  const handleOpenFile = useCallback(async () => {
    if (!outputPath) return
    await invoke('open_file', { path: outputPath }).catch((e) => {
      console.error('Failed to open file:', e)
    })
  }, [outputPath])

  const handleRevealInFolder = useCallback(async () => {
    if (!outputPath) return
    await invoke('reveal_in_folder', { path: outputPath }).catch((e) => {
      console.error('Failed to reveal in folder:', e)
    })
  }, [outputPath])

  const handleRedownload = useCallback(() => {
    onRedownload()
  }, [onRedownload])

  // No download in progress
  if (
    !isPending &&
    !isDownloading &&
    !isComplete &&
    !hasError &&
    !isWaitingForTurn
  ) {
    return null
  }

  return (
    <div className="bg-muted/50 mt-2 space-y-2 rounded-md p-2">
      {/* Complete View - highest priority */}
      {isComplete && (
        <div className={`flex ${MIN_HEIGHT} items-center justify-between`}>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span className="text-muted-foreground">
              {t('video.download_complete')}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenFile}
              className="h-8 px-2 text-xs"
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              {t('video.open_file')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevealInFolder}
              className="h-8 px-2 text-xs"
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              {t('video.open_folder')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRedownload}
              className="h-8 px-2 text-xs"
            >
              <Download className="mr-1 h-3 w-3" />
              {t('video.redownload')}
            </Button>
          </div>
        </div>
      )}

      {/* Error View - second priority */}
      {hasError && (
        <div className={`flex ${MIN_HEIGHT} items-center justify-between`}>
          <div className="text-destructive flex items-center gap-2 text-sm">
            <span>{errorMessage || t('video.download_failed_part')}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="h-8 px-2 text-xs"
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            {t('video.retry')}
          </Button>
        </div>
      )}

      {/* Running View - third priority */}
      {isDownloading && (
        <div
          className={`text-muted-foreground ${MIN_HEIGHT} flex items-center gap-x-3 text-xs`}
        >
          <div className="flex-1">
            <StageProgress
              icon="🔊"
              labelKey="video.stage_audio"
              progressEntries={progressEntries}
              stageName="audio"
              t={t}
            />
          </div>

          <div className="flex-1">
            <StageProgress
              icon="🎬"
              labelKey="video.stage_video"
              progressEntries={progressEntries}
              stageName="video"
              t={t}
            />
          </div>

          <div className="flex-1">
            {/* Merge Stage - has special logic for merging state */}
            <MergeStageProgress progressEntries={progressEntries} t={t} />
          </div>

          {/* Cancel button - inline */}
          {canCancel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <CircleX animateOnHover />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="top" arrow>
                {t('video.cancel_download')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Cancelling View */}
      {isCancelling && (
        <div
          className={`text-muted-foreground ${MIN_HEIGHT} flex items-center gap-2 text-sm`}
        >
          <div className="h-2 w-2 animate-pulse rounded-full bg-current" />
          <span>{t('video.cancelling') || 'Cancelling...'}</span>
        </div>
      )}

      {/* Cancelled View */}
      {isCancelled && (
        <div
          className={`text-muted-foreground ${MIN_HEIGHT} flex items-center justify-between text-sm`}
        >
          <span>{t('video.download_cancelled')}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={onRedownload}
            className="h-8 px-2 text-xs"
          >
            <Download className="mr-1 h-3 w-3" />
            {t('video.redownload')}
          </Button>
        </div>
      )}

      {/* Pending View - lowest priority */}
      {(isPending || isWaitingForTurn) && !isCancelling && (
        <div
          className={`text-muted-foreground ${MIN_HEIGHT} flex items-center gap-2 text-sm`}
        >
          <div className="h-2 w-2 animate-pulse rounded-full bg-current" />
          <span>{t('video.download_pending')}</span>
          {/* Cancel button with label */}
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="text-muted-foreground hover:text-destructive ml-auto h-7 px-2 text-xs"
            >
              <CircleX animateOnHover className="size-4" />
              {t('actions.cancel')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
