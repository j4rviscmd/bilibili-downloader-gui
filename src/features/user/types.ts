export type User = {
  code: number
  message: string
  ttl: number
  data: UserData
}

type UserData = {
  uname: string
  isLogin: boolean
  wbiImg: UserDataImg
}

type UserDataImg = {
  imgUrl: string
  subUrl: string
}
