import { useAppDispatch, useAppSelector } from '@/app/hooks'
import {
  decrement,
  increment,
  selectCount,
  setCount,
} from '@/features/count/countSlice'

export function useCount() {
  const dispatch = useAppDispatch()
  const value = useAppSelector(selectCount)

  const incrementCount = () => dispatch(increment())
  const decrementCount = () => dispatch(decrement())
  const setAbsoluteCount = (newVal: number) => dispatch(setCount(newVal))

  return { value, incrementCount, decrementCount, setAbsoluteCount }
}
