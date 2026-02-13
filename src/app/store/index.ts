import countReducer from '@/features/count/model/countSlice'
import favoriteReducer from '@/features/favorite/model/favoriteSlice'
import historyReducer from '@/features/history/model/historySlice'
import thumbnailCacheReducer from '@/features/history/model/thumbnailSlice'
import initReducer from '@/features/init/model/initSlice'
import settingReducer from '@/features/settings/settingsSlice'
import { sidebarReducer } from '@/features/sidebar'
import updaterReducer from '@/features/updater/model/updaterSlice'
import userReducer from '@/features/user/userSlice'
import inputReducer from '@/features/video/model/inputSlice'
import videoReducer from '@/features/video/model/videoSlice'
import watchHistoryReducer from '@/features/watch-history/model/watchHistorySlice'
import downloadStatusReducer from '@/shared/downloadStatus/downloadStatusSlice'
import progressReducer from '@/shared/progress/progressSlice'
import queueReducer from '@/shared/queue/queueSlice'
import { configureStore } from '@reduxjs/toolkit'
import {
  useSelector as rawUseSelector,
  useDispatch,
  type TypedUseSelectorHook,
} from 'react-redux'

/**
 * Configured Redux store with all application reducers.
 *
 * Combines feature slices (video, history, settings, etc.) and shared
 * utilities (progress, queue, download status) into a single state tree.
 * DevTools enabled in non-production environments.
 */
export const store = configureStore({
  reducer: {
    count: countReducer,
    downloadStatus: downloadStatusReducer,
    favorite: favoriteReducer,
    history: historyReducer,
    init: initReducer,
    input: inputReducer,
    progress: progressReducer,
    queue: queueReducer,
    settings: settingReducer,
    sidebar: sidebarReducer,
    thumbnailCache: thumbnailCacheReducer,
    updater: updaterReducer,
    user: userReducer,
    video: videoReducer,
    watchHistory: watchHistoryReducer,
  },
  devTools: process.env.NODE_ENV !== 'production',
})

/** Type representing the entire Redux state tree. */
export type RootState = ReturnType<typeof store.getState>

/** Type representing the Redux dispatch function with typed actions. */
export type AppDispatch = typeof store.dispatch

/** Typed hook to dispatch actions with proper type inference. */
export const useAppDispatch: () => AppDispatch = useDispatch

/** Typed hook to select from the Redux store with proper type inference. */
export const useSelector: TypedUseSelectorHook<RootState> = rawUseSelector
