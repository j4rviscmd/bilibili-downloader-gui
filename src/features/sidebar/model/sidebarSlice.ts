import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/**
 * サイドバーの状態管理
 *
 * サイドバーの開閉状態を管理するRedux状態。
 * この状態は settings.json に永続化され、ページ遷移後も維持される。
 */
export type SidebarState = {
  /** サイドバーが開いているかどうか */
  sidebarOpen: boolean
}

const initialState: SidebarState = {
  sidebarOpen: true,
}

/**
 * サイドバー用Redux Slice
 *
 * サイドバーの開閉状態を管理する。状態はRedux Toolkitの
 * createSliceを使用して定義され、setSidebarOpenアクションを通じて更新される。
 */
export const sidebarSlice = createSlice({
  name: 'sidebar',
  initialState,
  reducers: {
    /**
     * サイドバーの開閉状態を設定
     *
     * @param state - 現在のRedux状態
     * @param action - boolean値を含むアクション（true: 開く, false: 閉じる）
     */
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload
    },
  },
})

export const { setSidebarOpen } = sidebarSlice.actions
export default sidebarSlice.reducer
