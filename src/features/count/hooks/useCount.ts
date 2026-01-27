import { useAppDispatch, useSelector } from '@/app/store'
import {
  decrement,
  increment,
  setCount,
} from '@/features/count/model/countSlice'

/**
 * Custom hook for managing counter state.
 *
 * Provides access to the current count value and methods to
 * increment, decrement, or set the counter to a specific value.
 *
 * @returns An object containing the current count value and action methods.
 *
 * @example
 * ```typescript
 * const { value, incrementCount, decrementCount, setAbsoluteCount } = useCount()
 *
 * incrementCount() // value becomes 1
 * decrementCount() // value becomes 0
 * setAbsoluteCount(10) // value becomes 10
 * ```
 */
export function useCount() {
  const dispatch = useAppDispatch()
  const value = useSelector((state) => state.count.value)

  const incrementCount = () => dispatch(increment())
  const decrementCount = () => dispatch(decrement())
  const setAbsoluteCount = (newVal: number) => dispatch(setCount(newVal))

  return { value, incrementCount, decrementCount, setAbsoluteCount }
}
