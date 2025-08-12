import countReducer from '@/features/count/countSlice'
import initReducer from '@/features/init/initSlice'
import inputReducer from '@/features/video/inputSlice'
import progressReducer from '@/shared/progress/progressSlice'
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
  },
  devTools: process.env.NODE_ENV !== 'production',
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useSelector: TypedUseSelectorHook<RootState> = rawUseSelector
export const useAppDispatch: () => AppDispatch = useDispatch
