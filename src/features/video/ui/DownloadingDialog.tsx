import { type RootState, useAppDispatch, useSelector } from '@/app/store'
import { useVideoInfo } from '@/features/video'
import { resetInput } from '@/features/video/model/inputSlice'
import { resetVideo } from '@/features/video/model/videoSlice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import { clearError } from '@/shared/downloadStatus/downloadStatusSlice'
import { clearProgress } from '@/shared/progress/progressSlice'
import { Button } from '@/shared/ui/button'
import CircleIndicator from '@/shared/ui/CircleIndicator'
import ProgressStatusBar, { type Progress } from '@/shared/ui/Progress'
import { Download, Music, Play, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * ダウンロードステージに基づいてプログレスバーのラベルとアイコンを決定します。
 *
 * @param id - ダウンロードID（一時ステージ検出用）
 * @param stage - ダウンロードステージ（'audio'、'video'、'merge'）
 * @param t - 翻訳関数
 * @returns [ラベル, アイコン] のタプル
 *
 * @private
 */
const getBarInfo = (
  id: string | undefined,
  stage: string | undefined,
  t: (k: string) => string,
): [string, React.ReactNode] => {
  const key = stage || id

  switch (key) {
    case 'audio':
    case 'temp_audio':
      return [t('video.bar_audio'), <Music key="audio" size={13} />]
    case 'video':
    case 'temp_video':
      return [t('video.bar_video'), <Video key="video" size={13} />]
    case 'merge':
      return [t('video.bar_merge'), <Play key="merge" size={13} />]
    default:
      return ['', null]
  }
}

/**
 * ダウンロード進捗を表示するモーダルダイアログコンポーネント。
 *
 * すべてのアクティブなダウンロードのリアルタイム進捗を表示します：
 * - 親IDでグループ化されたプログレスバー（マルチパートダウンロード）
 * - オーディオ、動画、マージステージの個別バー
 * - 未開始のパートのキュー待機リスト
 * - エラー表示と再読み込みプロンプト
 * - ページをリロードする完了ボタン
 *
 * ダイアログはモーダルで、ダウンロードが完了またはエラーになるまで閉じることができません。
 *
 * @example
 * ```tsx
 * <DownloadingDialog />
 * ```
 */
function DownloadingDialog() {
  const { progress, input, video } = useVideoInfo()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  /**
   * プログレスエントリーの表示タイトルを導出します。
   *
   * マルチパートダウンロード（パターン: -p{number}）の場合はパートタイトルを返し、
   * シングルダウンロードの場合は動画タイトルを返します。
   *
   * @param p - プログレス情報
   * @returns 表示タイトル
   *
   * @private
   */
  const deriveTitle = (p: Progress): string | undefined => {
    const match = p.downloadId.match(/-p(\d+)$/)
    if (!match) return video?.title
    const idx = parseInt(match[1], 10) - 1
    return input.partInputs[idx]?.title
  }

  /**
   * ユーザーがダイアログを閉じる際に、ダウンロード関連の状態をすべてリセットします。
   *
   * 入力、動画情報、プログレス、エラー状態をクリアします。
   *
   * @private
   */
  const onClick = () => {
    dispatch(resetInput())
    dispatch(resetVideo())
    dispatch(clearProgress())
    dispatch(clearError())
  }

  const hasDlQue = progress.length > 0

  const phaseOrder = ['audio', 'video', 'merge']

  // Group progress entries by parentId for multi-part downloads
  const groups = progress.reduce<Record<string, Progress[]>>((acc, p) => {
    const parent = p.parentId || p.downloadId
    if (!acc[parent]) acc[parent] = []
    acc[parent].push(p)
    return acc
  }, {})

  // Extract active page numbers from progress entries
  const activePages = new Set(
    Object.values(groups)
      .flat()
      .map((p) => p.downloadId.match(/-p(\d+)$/)?.[1])
      .filter((page): page is string => page !== undefined)
      .map(Number),
  )

  // Parts waiting in queue
  const notInProgress = input.partInputs.filter(
    (part) => part.selected && !activePages.has(part.page),
  )

  // Active stages (exclude complete)
  const activeStages = progress.filter((p) =>
    phaseOrder.includes(p.stage || ''),
  )

  const { hasError, errorMessage } = useSelector(
    (s: RootState) => s.downloadStatus,
  )

  // Determine if download is still in progress
  const isDownloading =
    !hasError &&
    (activeStages.some((p) => !p.isComplete) || notInProgress.length > 0)

  /**
   * ダイアログのボタンテキストを決定します。
   *
   * ダウンロード中は空文字、エラー時は再読み込みメッセージ、
   * 完了時は完了メッセージを返します。
   *
   * @returns ボタンテキスト
   *
   * @private
   */
  function getButtonText(): string {
    if (isDownloading) return ''
    if (hasError) return t('video.reload_after_error')
    return t('video.download_completed')
  }

  return (
    <Dialog modal open={hasDlQue}>
      <DialogContent
        disableOutsideClick
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="bg-card flex max-h-[80%] flex-col items-center justify-center rounded-xl border [&>button]:hidden"
      >
        <DialogHeader className="w-full">
          <DialogTitle className="text-primary font-display flex w-full items-center">
            <Download size={18} className="mr-2" />
            <span className="text-lg">{t('video.progress_title')}</span>
          </DialogTitle>
          <DialogDescription hidden />
        </DialogHeader>
        <div className="flex h-full w-full flex-col items-center overflow-auto">
          {hasDlQue &&
            Object.entries(groups).map(([parentId, entries]) => {
              const sorted = [...entries].sort((a: Progress, b: Progress) => {
                const ai = a.stage ? phaseOrder.indexOf(a.stage) : -1
                const bi = b.stage ? phaseOrder.indexOf(b.stage) : -1
                return ai - bi
              })
              const firstActive = sorted.find(
                (p: Progress) => p.stage && p.stage !== 'complete',
              )
              const groupTitle = firstActive
                ? deriveTitle(firstActive)
                : (video?.title ?? '')

              return (
                <div
                  key={parentId}
                  className="bg-card hover:border-border/80 mb-2 w-full rounded-lg border px-2.5 py-2.5 transition-colors duration-200"
                >
                  {groupTitle && (
                    <div
                      className="text-md mb-1.5 truncate px-1.5 leading-tight font-semibold"
                      title={groupTitle}
                    >
                      {groupTitle}
                    </div>
                  )}
                  {sorted.map((p: Progress) => {
                    const [barLabel, barIcon] = getBarInfo(
                      p.downloadId,
                      p.stage,
                      t,
                    )
                    const key = p.internalId || `${p.downloadId}:${p.stage}`
                    if (!p.stage || p.stage === 'complete') return null
                    const ariaLabel =
                      typeof barLabel === 'string' ? barLabel : undefined
                    return (
                      <div
                        key={key}
                        className="text-accent-foreground box-border w-full px-2"
                      >
                        <div className="mb-2 flex items-center">
                          <span className="mr-2" aria-label={ariaLabel}>
                            {barIcon}
                          </span>
                        </div>
                        <div className="px-2">
                          {p.stage === 'merge' ? (
                            <div
                              className="flex items-center justify-between py-1 text-sm"
                              aria-label={t('video.bar_merge')}
                            >
                              <span>{t('video.bar_merge')}</span>
                              {!p.isComplete && <CircleIndicator r={10} />}
                              {p.isComplete && (
                                <span className="font-medium text-green-500">
                                  {t('video.completed')}
                                </span>
                              )}
                            </div>
                          ) : (
                            <ProgressStatusBar progress={p} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          {notInProgress.map((part) => (
            <div
              key={part.page}
              className="bg-card hover:border-border/80 mb-2 w-full rounded-lg border px-2.5 py-2.5 transition-colors duration-200"
            >
              <div
                className="text-md mb-0.5 truncate px-1.5 leading-tight font-semibold"
                title={part.title}
              >
                <span className="pr-1">{t('video.queue_waiting_prefix')}</span>
                <span>{part.title}</span>
              </div>
            </div>
          ))}
        </div>

        {hasError && (
          <div
            role="alert"
            aria-live="polite"
            className="border-destructive/50 bg-destructive/10 text-destructive mb-3 w-full rounded-lg border px-3 py-2.5 text-sm"
          >
            <div className="mb-1 font-semibold">
              {t('video.download_failed')}
            </div>
            <div className="truncate" title={errorMessage || ''}>
              {errorMessage}
            </div>
            <div className="text-muted-foreground mt-1.5 text-xs">
              {t('video.reload_after_error')}
            </div>
          </div>
        )}
        <div>
          <Button
            disabled={isDownloading}
            onClick={onClick}
            className="h-11 px-6"
          >
            {isDownloading ? <CircleIndicator r={10} /> : getButtonText()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default DownloadingDialog
