import countReducer from '@/features/count/countSlice'
import initReducer from '@/features/init/initSlice'
import { configureStore } from '@reduxjs/toolkit'

export const store = configureStore({
  reducer: {
    count: countReducer,
    init: initReducer,
    // 他の feature slice も同様に追加可能
  },
  devTools: process.env.NODE_ENV !== 'production',
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
