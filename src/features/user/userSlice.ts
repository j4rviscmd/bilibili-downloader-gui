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
  hasCookie: false,
}

/**
 * Redux slice for user authentication state.
 *
 * Stores the current Bilibili user's information including login status,
 * username, and WBI signature data for API request signing.
 */
export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    /**
     * Replaces the entire user state.
     *
     * @param _ - Previous state (unused, will be replaced)
     * @param action - Action containing the new user object
     */
    setUser: (_, action: PayloadAction<User>) => {
      return action.payload
    },
  },
})

export const { setUser } = userSlice.actions
export default userSlice.reducer
