/**
 * Download status feature - Public API
 *
 * 各パートのDL状況を一覧表示するダイアログと、サイドバーの起動ボタンを提供する。
 * 開閉状態は downloadStatusDialog slice で管理（settingsSlice.dialogOpen と同パターン）。
 */

// UI
export { DownloadStatusDialog } from './ui/DownloadStatusDialog'
export { OpenDownloadStatusDialogButton } from './ui/OpenDownloadStatusDialogButton'

// Redux actions / reducer
export {
  closeDownloadStatusDialog,
  default as downloadStatusDialogReducer,
  openDownloadStatusDialog,
  setActiveDownloadStatusParent,
} from './model/downloadStatusDialogSlice'

// Selectors
export {
  selectActiveParentId,
  selectDownloadStatusDialogOpen,
  selectDownloadStatusDialogState,
  selectOverallSummary,
  selectPartStatusRows,
  selectResolvedParentId,
} from './model/selectors'

// Hook
export { useDownloadStatusDialog } from './hooks/useDownloadStatusDialog'

// Types
export type {
  DownloadPartStatus,
  DownloadStatusDialogState,
  OverallSummary,
  PartStatusRowModel,
} from './model/types'
