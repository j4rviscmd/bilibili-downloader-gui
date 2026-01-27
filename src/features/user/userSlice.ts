import type { User } from '@/features/user/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: {
    uname: '',
    isLogin: false,
    wbiImg: {
      imgUrl: '',
      subUrl: '',
    },
  },
}

export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (_, action: PayloadAction<User>) => {
      return action.payload
    },
  },
})

export const { setUser } = userSlice.actions
export default userSlice.reducer
