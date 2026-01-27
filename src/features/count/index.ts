/**
 * Public API for the count feature.
 *
 * A simple counter feature demonstrating Redux Toolkit patterns.
 * Used primarily for testing and demonstration purposes.
 * @module features/count
 */

export { useCount } from './hooks/useCount'
export {
  countSlice,
  decrement,
  increment,
  selectCount,
  setCount,
} from './model/countSlice'
export type { CountState } from './types'
