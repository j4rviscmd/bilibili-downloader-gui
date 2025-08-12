import { store, useSelector } from '@/app/store'
import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'
import { setInput } from '@/features/video/inputSlice'
import type { Input } from '@/features/video/types'

export const useVideoInfo = () => {
  const input = useSelector((state) => state.input)
  const onChange = async (input: Input) => {
    store.dispatch(setInput(input))

    // videoId取得
    // e.g. https://www.bilibili.com/video/BV1pJ411E7Eb
    // -> BV1pJ411E7Eb
    const id = extractId(input.url)
    if (id) {
      console.log(`Extracted video ID: ${id}`)
      await fetchVideoInfo(id)
    }
  }

  const extractId = (url: string) => {
    const match = url.match(/\/video\/([a-zA-Z0-9]+)/)

    return match ? match[1] : null
  }

  return {
    input,
    onChange,
  }
}
