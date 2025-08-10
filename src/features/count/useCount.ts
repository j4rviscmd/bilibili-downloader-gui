import { useAppDispatch, useSelector } from '@/app/store'
import { decrement, increment, setCount } from '@/features/count/countSlice'

export function useCount() {
  const dispatch = useAppDispatch()
  const value = useSelector((state) => state.count.value)

  const incrementCount = () => dispatch(increment())
  const decrementCount = () => dispatch(decrement())
  const setAbsoluteCount = (newVal: number) => dispatch(setCount(newVal))

  return { value, incrementCount, decrementCount, setAbsoluteCount }
}
