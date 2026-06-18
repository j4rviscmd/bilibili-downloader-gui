import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import type { DownloadStatusDialogState } from './types'

/**
 * 初期状態。ダイアログは閉じており、表示対象の親は未確定。
 */
const initialState: DownloadStatusDialogState = {
  dialogOpen: false,
  activeParentId: null,
}

/**
 * ダウンロード状況ダイアログの開閉状態を管理するスライス。
 *
 * `settingsSlice.dialogOpen` と同じ極小パターン。
 * `activeParentId` に親DL IDを保持し、再オープン時に同じDL状況を表示する。
 */
const downloadStatusDialogSlice = createSlice({
  name: 'downloadStatusDialog',
  initialState,
  reducers: {
    /**
     * ダイアログを開く。parentId を渡すと表示対象を固定する。
     * 省略時は selector が直近のアクティブ親を解決する。
     */
    openDownloadStatusDialog(state, action: PayloadAction<string | undefined>) {
      state.dialogOpen = true
      if (action.payload !== undefined) {
        state.activeParentId = action.payload
      }
    },
    /** ダイアログを閉じる。activeParentId は保持して再オープン時に再利用する。 */
    closeDownloadStatusDialog(state) {
      state.dialogOpen = false
    },
    /** 表示対象の親DL IDを明示的に切り替える。 */
    setActiveDownloadStatusParent(state, action: PayloadAction<string | null>) {
      state.activeParentId = action.payload
    },
  },
})

export const {
  openDownloadStatusDialog,
  closeDownloadStatusDialog,
  setActiveDownloadStatusParent,
} = downloadStatusDialogSlice.actions

export default downloadStatusDialogSlice.reducer
