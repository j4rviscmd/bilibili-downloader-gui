/**
 * User Feature Public API
 *
 * This module provides the public API for user-related functionality including:
 * - User authentication state management
 * - User profile information
 * - User preferences and settings
 *
 * @module features/user
 *
 * @example
 * ```typescript
 * import { useUser } from '@/features/user'
 *
 * function UserProfile() {
 *   const { userInfo, isLoggedIn, getUserInfo } = useUser()
 *
 *   return (
 *     <div>
 *       {isLoggedIn ? (
 *         <p>Welcome, {userInfo?.name}</p>
 *       ) : (
 *         <p>Please log in</p>
 *       )}
 *     </div>
 *   )
 * }
 * ```
 */

// Custom hooks
export * from './useUser'

// Type definitions
export * from './types'

// Redux state management
export { default as userReducer } from './userSlice'
