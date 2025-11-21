import countReducer from '@/features/count/countSlice'
import initReducer from '@/features/init/initSlice'
import inputReducer from '@/features/video/inputSlice'
import videoReducer from '@/features/video/videoSlice'
import downloadStatusReducer from '@/shared/downloadStatus/downloadStatusSlice'
import progressReducer from '@/shared/progress/progressSlice'
import queueReducer from '@/shared/queue/queueSlice'
import settingReducer from '@/shared/settings/settingsSlice'
import userReducer from '@/shared/user/userSlice'
import { configureStore } from '@reduxjs/toolkit'
import {
  useSelector as rawUseSelector,
  useDispatch,
  type TypedUseSelectorHook,
} from 'react-redux'

export const store = configureStore({
  reducer: {
    count: countReducer,
    init: initReducer,
    user: userReducer,
    progress: progressReducer,
    input: inputReducer,
    video: videoReducer,
    settings: settingReducer,
    queue: queueReducer,
    downloadStatus: downloadStatusReducer,
  },
  devTools: process.env.NODE_ENV !== 'production',
})

// NOTE: エラー状態参照のため暫定的に window へ公開 (将来削除検討)
declare global {
  interface Window {
    __REDUX_STORE__?: typeof store
  }
}
window.__REDUX_STORE__ = store

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useSelector: TypedUseSelectorHook<RootState> = rawUseSelector
export const useAppDispatch: () => AppDispatch = useDispatch
