import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import type { Progress } from '@/shared/ui/Progress'

/**
 * 進捗エントリの内部 ID を計算します。
 *
 * 内部 ID は、ダウンロード内の進捗エントリを一意に識別するために使用されます。
 * 'complete' ステージの場合、ボタンロック解除を有効にするために
 * 'merge' エントリが 'complete' に置き換えられることを保証します。
 *
 * @param state - 現在の進捗配列
 * @param payload - ID を計算する進捗エントリ
 * @returns `{downloadId}:{stage}` 形式または単に `{downloadId}` の内部 ID 文字列
 */
function computeInternalId(state: Progress[], payload: Progress): string {
  if (payload.stage === 'complete') {
    const mergeId = `${payload.downloadId}:merge`
    const hasMerge = state.some((p) => p.internalId === mergeId)
    return hasMerge ? mergeId : `${payload.downloadId}:complete`
  }
  return payload.stage
    ? `${payload.downloadId}:${payload.stage}`
    : payload.downloadId
}

const initialState: Progress[] = []

/**
 * ダウンロード進捗追跡用の Redux slice。
 *
 * 各ダウンロードのフェーズごとの進捗エントリを保存します。
 * 各エントリは downloadId とステージ（音声、動画、マージ）から計算された
 * 内部 ID を持ちます。'complete' ステージはボタンロック解除を有効にするために
 * 'merge' エントリを置き換えます。
 */
export const progressSlice = createSlice({
  name: 'progress',
  initialState,
  reducers: {
    /**
     * 進捗エントリを更新または追加します。
     *
     * downloadId とステージに基づいて内部 ID を計算します。
     * 同じ内部 ID のエントリが存在する場合は更新され、
     * それ以外の場合は新しいエントリが追加されます。
     * 'complete' ステージは、存在する場合は 'merge' エントリを置き換えます。
     *
     * @param state - 現在の進捗配列
     * @param action - 進捗データを含むアクション
     */
    setProgress(state, action: PayloadAction<Progress>) {
      const payload = action.payload
      // compute internal id and parent id
      // internalId: 'complete' replaces existing 'merge' to ensure button unlock
      const internalId = computeInternalId(state, payload)
      const parentId = payload.downloadId
      const entry = { ...payload, internalId, parentId }
      const idx = state.findIndex((p) => p.internalId === internalId)

      if (idx === -1) {
        state.push(entry)
      } else {
        state[idx] = entry
      }
    },
    /**
     * すべての進捗エントリをクリアします。
     */
    clearProgress() {
      return []
    },
    /**
     * 特定のダウンロードの進捗エントリをクリアします。
     *
     * ダウンロードがキャンセルされたときに進捗データを削除するために使用されます。
     *
     * @param state - 現在の進捗配列
     * @param action - クリアするダウンロード ID を含むアクション
     */
    clearProgressByDownloadId(state, action: PayloadAction<string>) {
      const downloadId = action.payload
      return state.filter((p) => p.downloadId !== downloadId)
    },
  },
})

export const { setProgress, clearProgress, clearProgressByDownloadId } =
  progressSlice.actions
export default progressSlice.reducer

/**
 * ダウンロード ID による進捗エントリのメモ化セレクターファクトリー。
 *
 * @param downloadId - フィルタリングするダウンロード ID
 * @returns ダウンロードの進捗エントリを返すメモ化セレクター
 */
export const selectProgressEntriesByDownloadId = (downloadId: string) =>
  createSelector([(state: RootState) => state.progress], (progress) =>
    progress.filter((p) => p.downloadId === downloadId),
  )
