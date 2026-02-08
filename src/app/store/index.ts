/**
 * Redux store configuration module.
 *
 * Centralizes all Redux reducers and provides typed hooks for the
 * application.
 * @module app/store
 */

import countReducer from '@/features/count/model/countSlice'
import historyReducer from '@/features/history/model/historySlice'
import thumbnailCacheReducer from '@/features/history/model/thumbnailSlice'
import initReducer from '@/features/init/model/initSlice'
import settingReducer from '@/features/settings/settingsSlice'
import updaterReducer from '@/features/updater/model/updaterSlice'
import userReducer from '@/features/user/userSlice'
import inputReducer from '@/features/video/model/inputSlice'
import videoReducer from '@/features/video/model/videoSlice'
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
 * The Redux store instance containing all application state.
 *
 * Combines all feature and shared slices into a single store.
 * Redux DevTools are enabled in non-production environments.
 */
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
    history: historyReducer,
    thumbnailCache: thumbnailCacheReducer,
    updater: updaterReducer,
  },
  devTools: process.env.NODE_ENV !== 'production',
})

/**
 * Root state type derived from the store.
 *
 * Use this type for typing selector functions and accessing global state.
 */
export type RootState = ReturnType<typeof store.getState>

/**
 * App dispatch type including thunk middleware.
 *
 * Use this type for dispatching actions with full TypeScript support.
 */
export type AppDispatch = typeof store.dispatch

/**
 * Typed version of the `useSelector` hook.
 *
 * Automatically infers RootState type for better TypeScript experience.
 */
export const useSelector: TypedUseSelectorHook<RootState> = rawUseSelector

/**
 * Typed version of the `useDispatch` hook.
 *
 * Returns a dispatch function with full AppDispatch typing.
 */
export const useAppDispatch: () => AppDispatch = useDispatch
