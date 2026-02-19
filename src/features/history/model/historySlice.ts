import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/**
 * 完了したダウンロードを表す履歴エントリ。
 */
export type HistoryEntry = {
  /** 履歴の一意識別子 */
  id: string
  /** 動画タイトル */
  title: string
  /** Bilibili動画ID（BV識別子、後方互換性のために省略可能） */
  bvid?: string
  /** ソースURL */
  url: string
  /** 出力ファイル名 */
  filename?: string
  /** 出力ディレクトリパス */
  outputPath?: string
  /** ダウンロードタイムスタンプ（ISO 8601形式） */
  downloadedAt: string
  /** 動画長（秒単位） */
  duration?: number
  /** ダウンロードステータス */
  status: 'completed' | 'failed'
  /** ステータスが 'failed' の場合のエラーメッセージ */
  errorMessage?: string
  /** ファイルサイズ（バイト単位） */
  fileSize?: number
  /** 動画品質（例: '1080p', '720p'） */
  quality?: string
  /** サムネイル画像URL */
  thumbnailUrl?: string
}

/**
 * 既存コードとの互換性を維持するためのHistoryEntryのエイリアス。
 */
export type HistoryItem = HistoryEntry

/**
 * エントリフィルタリング用の履歴フィルタ。
 */
export type HistoryFilters = {
  /** ステータスフィルタ（all = フィルタリングなし） */
  status?: 'all' | 'completed' | 'failed'
  /** オプションの日付範囲開始（ISO 8601形式） */
  dateFrom?: string
}

/**
 * ダウンロード履歴を管理する履歴ステート。
 */
export type HistoryState = {
  /** 履歴エントリの配列 */
  entries: HistoryEntry[]
  /** 履歴操作用のローディング状態 */
  loading: boolean
  /** 操作が失敗した場合のエラーメッセージ */
  error: string | null
  /** 適用中の現在のフィルタ */
  filters: HistoryFilters
  /** 検索クエリ文字列 */
  searchQuery: string
}

const initialState: HistoryState = {
  entries: [],
  loading: false,
  error: null,
  filters: {},
  searchQuery: '',
}

/**
 * ダウンロード履歴管理用Reduxスライス。
 *
 * フィルタリングと検索機能を備えた完了したダウンロード履歴を管理します。
 * 履歴エントリは別途永続化されます（このスライスでは処理されません）。
 */
export const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    /**
     * 履歴のすべてのエントリを置き換えます。
     *
     * バックエンドから履歴を読み込むときに使用されます。
     *
     * @param state - 現在の履歴ステート
     * @param action - エントリの配列を含むアクション
     */
    setEntries(state, action: PayloadAction<HistoryEntry[]>) {
      state.entries = action.payload
    },
    /**
     * 履歴に単一のエントリを追加します。
     *
     * エントリを配列の先頭に追加します（新しい順）。
     *
     * @param state - 現在の履歴ステート
     * @param action - 追加するエントリを含むアクション
     */
    addEntry(state, action: PayloadAction<HistoryEntry>) {
      state.entries.unshift(action.payload)
    },
    /**
     * IDで履歴エントリを削除します。
     *
     * @param state - 現在の履歴ステート
     * @param action - 削除するエントリIDを含むアクション
     */
    removeEntry(state, action: PayloadAction<string>) {
      state.entries = state.entries.filter((e) => e.id !== action.payload)
    },
    /**
     * すべての履歴エントリをクリアします。
     *
     * @param state - 現在の履歴ステート
     */
    clearHistory(state) {
      state.entries = []
    },
    /**
     * 履歴フィルタを更新します。
     *
     * @param state - 現在の履歴ステート
     * @param action - 新しいフィルタを含むアクション
     */
    setFilters(state, action: PayloadAction<HistoryFilters>) {
      state.filters = action.payload
    },
    /**
     * 検索クエリを更新します。
     *
     * @param state - 現在の履歴ステート
     * @param action - 検索クエリ文字列を含むアクション
     */
    setSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload
    },
    /**
     * ローディング状態を設定します。
     *
     * @param state - 現在の履歴ステート
     * @param action - ローディング真偽値を含むアクション
     */
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload
    },
    /**
     * エラーメッセージを設定します。
     *
     * @param state - 現在の履歴ステート
     * @param action - エラーメッセージまたはnullを含むアクション
     */
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
    },
  },
})

export const {
  setEntries,
  addEntry,
  removeEntry,
  clearHistory,
  setFilters,
  setSearchQuery,
  setLoading,
  setError,
} = historySlice.actions

export default historySlice.reducer
