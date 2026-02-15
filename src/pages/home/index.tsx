import { store, useSelector } from '@/app/store'
import { useInit } from '@/features/init'
import {
  deselectAll,
  DownloadButton,
  selectAll,
  useVideoInfo,
  VideoForm1,
  VideoInfoProvider,
} from '@/features/video'
import VideoPartCard from '@/features/video/ui/VideoPartCard'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { selectHasActiveDownloads } from '@/shared/queue'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Separator } from '@/shared/ui/separator'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Info } from 'lucide-react'
import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'

type TooltipButtonProps = {
  label: string
  onClick: () => void
  disabled?: boolean
  tooltip?: string
}

/**
 * 無効状態時にツールチップを表示するボタンコンポーネント。
 *
 * 無効な状態の場合、ツールチップでその理由を表示します。
 *
 * @param props.label - ボタンのラベル
 * @param props.onClick - クリック時のコールバック
 * @param props.disabled - 無効状態かどうか
 * @param props.tooltip - ツールチップに表示するテキスト（オプション）
 *
 * @private
 */
function TooltipButton({
  label,
  onClick,
  disabled,
  tooltip,
}: TooltipButtonProps) {
  const button = (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  )

  if (!tooltip) return button

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{button}</span>
        </TooltipTrigger>
        <TooltipContent side="top" arrow>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * ホームページの内部コンテンツコンポーネント。
 *
 * VideoInfoContextを使用して、動画URL入力フォームとパート設定カードを表示します。
 * このコンポーネントは`VideoInfoProvider`内でレンダリングされる必要があります。
 *
 * 機能：
 * - ログイン未登录時のベネフィット表示
 * - 動画URL入力（ステップ1）
 * - パート選択と設定（ステップ2）
 * - 全選択/全解除ボタン
 * - ダウンロードボタン
 * - autoFetchクエリパラメータによる自動取得
 *
 * @private
 */
function HomeContentInner() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { video, duplicateIndices, onValid1, isFetching } = useVideoInfo()
  const { t } = useTranslation()
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const user = useSelector((state) => state.user)
  const isLoggedIn = user.hasCookie && user.data?.isLogin

  // Handle autoFetch from query parameter
  useEffect(() => {
    const autoFetchUrl = searchParams.get('autoFetch')
    if (autoFetchUrl && !isFetching && video.parts.length === 0) {
      searchParams.delete('autoFetch')
      setSearchParams(searchParams, { replace: true })
      onValid1(autoFetchUrl)
    }
  }, [searchParams, isFetching, video.parts.length, onValid1, setSearchParams])

  const handleSelectAll = () => {
    store.dispatch(selectAll())
  }

  const handleDeselectAll = () => {
    store.dispatch(deselectAll())
  }

  function getSelectTooltip(): string | undefined {
    if (hasActiveDownloads) return t('video.download_in_progress')
    return undefined
  }

  return (
    <>
      {/* Login Benefits Info - shown only when not logged in */}
      {!isLoggedIn && (
        <Alert variant="info">
          <Info />
          <AlertTitle>{t('video.login_benefits_title')}</AlertTitle>
          <AlertDescription className="flex flex-wrap">
            <Trans
              i18nKey="video.login_benefits_description"
              components={{
                1: (
                  <button
                    type="button"
                    onClick={() => openUrl('https://www.bilibili.com')}
                    className="inline cursor-pointer text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  />
                ),
              }}
            />
            <span className="mt-1 w-full text-xs opacity-80">
              {t('video.login_benefits_restart_note')}
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Step 1: URL Input Card */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">
            {t('video.step1_title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VideoForm1 />
        </CardContent>
      </Card>

      {/* Step 2: Video Parts Configuration */}
      {video.parts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-display text-lg">
                {t('video.step2_title')}
              </CardTitle>
              <div className="flex items-center gap-2">
                <TooltipButton
                  label={t('video.select_all')}
                  onClick={handleSelectAll}
                  disabled={hasActiveDownloads}
                  tooltip={getSelectTooltip()}
                />
                <TooltipButton
                  label={t('video.deselect_all')}
                  onClick={handleDeselectAll}
                  disabled={hasActiveDownloads}
                  tooltip={getSelectTooltip()}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-0">
            {video.parts.map((_v, idx) => {
              const isLast = idx === video.parts.length - 1

              return (
                <div key={idx}>
                  <VideoPartCard
                    video={video}
                    page={idx + 1}
                    isDuplicate={duplicateIndices.includes(idx)}
                  />
                  {!isLast && <Separator className="my-3" />}
                </div>
              )
            })}
          </CardContent>
          <CardFooter>
            <DownloadButton />
          </CardFooter>
        </Card>
      )}
    </>
  )
}

/**
 * Home page content component (main application view).
 *
 * This is the content portion of the home page without the layout wrapper.
 * It should be rendered inside a PageLayoutShell or similar layout.
 *
 * Displays the primary UI for video downloads including:
 * - Video URL input form (Step 1)
 * - Video parts configuration forms (Step 2)
 * - Select all/deselect all buttons
 * - Download button
 * - Download progress (inline in each part card)
 *
 * Redirects to /init if the app is not initialized.
 * Supports autoFetch query parameter to automatically fetch video info.
 *
 * @example
 * ```tsx
 * // Inside PersistentPageLayout
 * <HomeContent />
 * ```
 */
export function HomeContent() {
  const { initiated } = useInit()
  const navigate = useNavigate()

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <VideoInfoProvider>
      <HomeContentInner />
    </VideoInfoProvider>
  )
}

export default HomeContent
