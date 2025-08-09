import countReducer from '@/features/count/countSlice'
import initReducer from '@/features/init/initSlice'
import progressReducer from '@/shared/progress/progressSlice'
import { configureStore } from '@reduxjs/toolkit'

export const store = configureStore({
  reducer: {
    count: countReducer,
    init: initReducer,
    progress: progressReducer,
  },
  devTools: process.env.NODE_ENV !== 'production',
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
