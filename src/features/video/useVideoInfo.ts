import { store, useSelector } from '@/app/store'
import { setInput } from '@/features/video/inputSlice'
import type { Input } from '@/features/video/types'

export const useVideoInfo = () => {
  const input = useSelector((state) => state.input)
  const onChange = (newInput: Input) => {
    store.dispatch(setInput(newInput))
  }

  return {
    input,
    onChange,
  }
}
