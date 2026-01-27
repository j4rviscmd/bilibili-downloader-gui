/**
 * Public API for the count feature.
 *
 * A simple counter feature demonstrating Redux Toolkit patterns.
 * Used primarily for testing and demonstration purposes.
 * @module features/count
 */

export { countSlice, increment, decrement, setCount, selectCount } from './model/countSlice'
export { useCount } from './hooks/useCount'
export type { CountState } from './types'
