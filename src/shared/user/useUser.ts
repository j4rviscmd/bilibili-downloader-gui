import { store, useSelector } from '@/app/store'
import { fetchUser } from '@/shared/user/api/fetchUser'
import type { User } from '@/shared/user/types'
import { setUser } from '@/shared/user/userSlice'

export const useUser = () => {
  const user = useSelector((state) => state.user)
  const onChangeUser = (user: User) => {
    store.dispatch(setUser(user))
  }

  const getUserInfo = async (): Promise<User | null> => {
    const res = await fetchUser()
    if (res) {
      // console.log('user')
      // console.log(JSON.stringify(res, null, 2))
      onChangeUser(res)

      return res
    }
    return null
  }

  return {
    user,
    onChangeUser,
    getUserInfo,
  }
}
