/**
 * Bilibili user response structure.
 *
 * Represents the API response from Bilibili's user info endpoint.
 */
export type User = {
  /** Response status code (0 = success) */
  code: number
  /** Response message from the API */
  message: string
  /** Time to live (TTL) value */
  ttl: number
  /** User data payload */
  data: UserData
  /** Indicates whether valid Bilibili cookies are available */
  hasCookie: boolean
}

/**
 * User information data.
 */
type UserData = {
  /** Username (display name) */
  uname: string
  /** Whether the user is currently logged in */
  isLogin: boolean
  /** WBI signature images (for API request signing) */
  wbiImg: UserDataImg
}

/**
 * WBI image URLs for request signing.
 */
type UserDataImg = {
  /** Main image URL */
  imgUrl: string
  /** Sub image URL */
  subUrl: string
}
