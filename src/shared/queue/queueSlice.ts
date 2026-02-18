import type { PayloadAction } from '@reduxjs/toolkit'
import { createAsyncThunk, createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import { callCancelAllDownloads, callCancelDownload } from './api/cancelApi'

type QueueItemStatus = 'pending' | 'running' | 'cancelling' | 'cancelled' | 'done' | 'error'

/**
 * 子アイテムに基づいて親キューアイテムのステータスを集約します。
 *
 * 一致する parentId を持つすべての子アイテムのステータスに基づいて親ステータスを更新します。
 * ステータスの優先順位: error > cancelling > running > done > cancelled > pending。
 * 子が存在せず、親が 'cancelling' 状態でない場合、キューから親を削除します。
 *
 * @param state - 変更する現在のキュー配列
 */
function aggregateParentStatuses(state: QueueItem[]): void {
  const parentIds = new Set(
    state.map((i) => i.parentId).filter((id): id is string => id != null),
  )

  // Collect parent IDs to remove (those with no children and not cancelling)
  const parentsToRemove: string[] = []

  parentIds.forEach((parentId) => {
    const parent = state.find((i) => i.downloadId === parentId)
    if (!parent) return

    const children = state.filter((i) => i.parentId === parentId)

    // If no children, mark parent for removal only if not in cancelling state
    if (children.length === 0) {
      // Keep parent during cancellation transition (waiting for next download)
      if (parent.status !== 'cancelling') {
        parentsToRemove.push(parentId)
      }
      return
    }

    const statuses = children.map((c) => c.status)

    // Priority: error > cancelling > running > done > cancelled > pending
    // Always derive status from children when they exist
    if (statuses.includes('error')) {
      parent.status = 'error'
    } else if (statuses.includes('cancelling')) {
      parent.status = 'cancelling'
    } else if (statuses.includes('running')) {
      parent.status = 'running'
    } else if (statuses.every((s) => s === 'done')) {
      parent.status = 'done'
    } else if (statuses.includes('cancelled')) {
      parent.status = 'cancelled'
    } else {
      parent.status = 'pending'
    }
  })

  // Remove parents with no children (and not cancelling)
  parentsToRemove.forEach((parentId) => {
    const index = state.findIndex((i) => i.downloadId === parentId)
    if (index !== -1) {
      state.splice(index, 1)
    }
  })
}

/**
 * ダウンロードタスクを表すキューアイテム。
 */
export type QueueItem = {
  /** ユニークなダウンロード識別子 */
  downloadId: string
  /** マルチパートダウンロードのグループ化のためのオプションの親 ID */
  parentId?: string
  /** 出力ファイル名 */
  filename?: string
  /** 現在のステータス */
  status?: QueueItemStatus
  /** ステータスが 'error' の場合のエラーメッセージ */
  errorMessage?: string
  /** 出力ファイルパス（ダウンロード完了後に利用可能） */
  outputPath?: string
  /** 動画タイトル */
  title?: string
}

const initialState: QueueItem[] = []

/**
 * 特定のダウンロードをキャンセルする非同期 thunk。
 *
 * バックエンドを呼び出す前にダウンロードステータスを 'cancelling' に設定し、
 * その後、'download_cancelled' イベントを通じてステータスが 'cancelled' に更新されます。
 *
 * @param downloadId - キャンセルするダウンロードのユニーク識別子
 */
export const cancelDownload = createAsyncThunk(
  'queue/cancelDownload',
  async (downloadId: string, { getState }) => {
    // Check if download exists
    const state = getState() as RootState
    const item = state.queue.find((i) => i.downloadId === downloadId)
    if (!item) {
      throw new Error(`Download not found: ${downloadId}`)
    }
    // Note: status may already be 'cancelling' due to pending reducer
    // Allow cancelling if status is pending, running, or cancelling
    const cancellableStatuses = ['pending', 'running', 'cancelling']
    if (!cancellableStatuses.includes(item.status || '')) {
      throw new Error(`Download is not cancellable: ${downloadId} (status: ${item.status})`)
    }

    const wasCancelled = await callCancelDownload(downloadId)
    if (!wasCancelled) {
      // Download may have completed before cancellation
      console.warn(`Download was not found in backend: ${downloadId}`)
    }
    return { downloadId, wasCancelled }
  },
)

/**
 * すべてのアクティブなダウンロードをキャンセルする非同期 thunk。
 *
 * バックエンドを呼び出す前に、すべての保留中/実行中のダウンロードを 'cancelling' に設定します。
 */
export const cancelAllDownloads = createAsyncThunk(
  'queue/cancelAllDownloads',
  async (_, { getState }) => {
    const state = getState() as RootState
    const cancellableIds = state.queue
      .filter((i) => i.status === 'pending' || i.status === 'running')
      .map((i) => i.downloadId)

    if (cancellableIds.length === 0) {
      return { count: 0, downloadIds: [] as string[] }
    }

    const count = await callCancelAllDownloads()
    return { count, downloadIds: cancellableIds }
  },
)

/**
 * ダウンロードキューマネジメント用の Redux slice。
 *
 * 保留中、実行中、完了したダウンロードのキューを管理します。
 * 子に基づいて親ステータスを自動的に更新します。
 */
export const queueSlice = createSlice({
  name: 'queue',
  initialState,
  reducers: {
    /**
     * ダウンロードをキューに追加します。
     *
     * 同じ downloadId を持つアイテムが既に存在する場合はスキップします。
     * 追加後に子に基づいて親ステータスを更新します。
     *
     * @param state - 現在のキューステート
     * @param action - キューアイテムを含むアクション
     */
    enqueue(state, action: PayloadAction<QueueItem>) {
      const payload = action.payload
      if (!state.find((i) => i.downloadId === payload.downloadId)) {
        state.push({ ...payload, status: payload.status || 'pending' })
      }
      aggregateParentStatuses(state)
    },
    /**
     * キューからダウンロードを削除します。
     *
     * 指定された ID が親である場合、すべての子も削除します。
     *
     * @param state - 現在のキューステート
     * @param action - 削除するダウンロード ID を含むアクション
     */
    dequeue(state, action: PayloadAction<string>) {
      const id = action.payload
      return state.filter((i) => i.downloadId !== id && i.parentId !== id)
    },
    /**
     * キューからすべてのアイテムをクリアします。
     */
    clearQueue() {
      return []
    },
    /**
     * キューアイテムのステータスを更新します。
     *
     * 子に基づいて親ステータスを自動的に集約します：
     * - 子が 'error' の場合、親は 'error' になります
     * - それ以外で子が 'running' の場合、親は 'running' になります
     * - すべての子が 'done' の場合、親は 'done' になります
     * - それ以外の場合、親は 'pending' になります
     *
     * @param state - 現在のキューステート
     * @param action - ダウンロード ID と新しいステータスを含むアクション
     */
    updateQueueStatus(
      state,
      action: PayloadAction<{
        downloadId: string
        status: QueueItemStatus
        errorMessage?: string
      }>,
    ) {
      const { downloadId, status, errorMessage } = action.payload
      const target = state.find((i) => i.downloadId === downloadId)
      if (target) {
        target.status = status
        if (errorMessage) target.errorMessage = errorMessage
      }

      aggregateParentStatuses(state)
    },
    /**
     * 新しいデータでキューアイテムを更新します。
     *
     * 提供されたフィールドを既存のアイテムデータにマージします。
     *
     * @param state - 現在のキューステート
     * @param action - ダウンロード ID と更新するフィールドを含むアクション
     */
    updateQueueItem(
      state,
      action: PayloadAction<Partial<QueueItem> & { downloadId: string }>,
    ) {
      const { downloadId, ...fields } = action.payload
      const target = state.find((i) => i.downloadId === downloadId)
      if (target) {
        Object.assign(target, fields)
      }
    },
    /**
     * ダウンロード ID による単一のキューアイテムを削除します。
     * 削除後に親ステータスを更新します。
     *
     * @param state - 現在のキューステート
     * @param action - 削除するダウンロード ID を含むアクション
     */
    clearQueueItem(state, action: PayloadAction<string>) {
      const id = action.payload
      const filtered = state.filter((i) => i.downloadId !== id)
      state.length = 0
      state.push(...filtered)
      aggregateParentStatuses(state)
    },
  },
  extraReducers: (builder) => {
    // cancelDownload pending: set status to 'cancelling'
    builder.addCase(cancelDownload.pending, (state, action) => {
      const item = state.find((i) => i.downloadId === action.meta.arg)
      if (item) {
        item.status = 'cancelling'
      }
      aggregateParentStatuses(state)
    })

    // cancelAllDownloads pending: set all pending/running to 'cancelling'
    builder.addCase(cancelAllDownloads.pending, (state) => {
      state.forEach((item) => {
        if (item.status === 'pending' || item.status === 'running') {
          item.status = 'cancelling'
        }
      })
      aggregateParentStatuses(state)
    })
  },
})

export const {
  enqueue,
  dequeue,
  clearQueue,
  updateQueueStatus,
  updateQueueItem,
  clearQueueItem,
} = queueSlice.actions
export default queueSlice.reducer

/**
 * 特定のパートインデックスに対して完了したキューアイテムを検索します。
 *
 * 正規表現パターン `-p(\d+)$` を使用して downloadId からパートインデックスを抽出します。
 * アイテムが見つかり、パートインデックスが一致し、ステータスが 'done' の場合にそのアイテムを返します。
 *
 * @param state - Redux ルートステート
 * @param partIndex - 1始まりのパート番号（downloadId 内の数字と一致）
 * @returns 見つかり、完了している場合はキューアイテム、それ以外の場合は undefined
 */
export function findCompletedItemForPart(
  state: RootState,
  partIndex: number,
): QueueItem | undefined {
  return state.queue.find((item) => {
    const match = item.downloadId.match(/-p(\d+)$/)
    return (
      match && parseInt(match[1], 10) === partIndex && item.status === 'done'
    )
  })
}

/**
 * パートインデックスによるキューからのダウンロード ID を選択します。
 *
 * 正規表現パターン `-p(\d+)$` を使用して downloadId からパートインデックスを抽出します。
 * 見つかり、パートインデックスが一致する場合にダウンロード ID を返します。
 *
 * @param state - Redux ルートステート
 * @param partIndex - 0始まりのパートインデックス（downloadId では +1 と一致）
 * @returns 見つかった場合はダウンロード ID、それ以外の場合は undefined
 */
export const selectDownloadIdByPartIndex = (
  state: { queue: QueueItem[] },
  partIndex: number,
): string | undefined => {
  return state.queue.find((item) => {
    const match = item.downloadId.match(/-p(\d+)$/)
    return match && parseInt(match[1], 10) === partIndex + 1
  })?.downloadId
}

/**
 * ダウンロード ID によるキューアイテムのメモ化セレクターファクトリー。
 *
 * @param downloadId - 検索するダウンロード ID
 * @returns キューアイテムを返すメモ化セレクター
 */
export const selectQueueItemByDownloadId = (downloadId: string) =>
  createSelector([(state: RootState) => state.queue], (queue) =>
    queue.find((q) => q.downloadId === downloadId),
  )

/**
 * いずれかのダウンロードがアクティブかどうかを確認するメモ化セレクター。
 *
 * 以下の場合に true を返します：
 * - 子アイテムが 'running' または 'pending' ステータスの場合
 * - 親アイテムが 'cancelling' ステータスの場合（ダウンロード間の遷移中）
 * - 親アイテムが 'pending' ステータスで子を持つ場合
 *
 * @param state - Redux ルートステート
 * @returns いずれかのダウンロードがアクティブな場合は true
 */
export const selectHasActiveDownloads = createSelector(
  [(state: RootState) => state.queue],
  (queue) => {
    // Get parent IDs that have children
    const parentIdsWithChildren = new Set(
      queue.map((i) => i.parentId).filter((id): id is string => id != null),
    )

    return queue.some((q) => {
      // Child items: check running/pending
      if (q.parentId) {
        return q.status === 'running' || q.status === 'pending'
      }
      // Parent in cancelling state is always active (transitioning)
      if (q.status === 'cancelling') {
        return true
      }
      // Parent with pending status is only active if it has children
      if (q.status === 'pending') {
        return parentIdsWithChildren.has(q.downloadId)
      }
      return false
    })
  },
)
