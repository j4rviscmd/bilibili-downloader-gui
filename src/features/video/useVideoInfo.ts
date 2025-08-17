import { store, useSelector } from '@/app/store'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'
import { formSchema1, formSchema2 } from '@/features/video/formSchema'
import { setQuality, setTitle, setUrl } from '@/features/video/inputSlice'
import { setVideo } from '@/features/video/videoSlice'

const extractId = (url: string) => {
  const match = url.match(/\/video\/([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

export const useVideoInfo = () => {
  const video = useSelector((state) => state.video)
  const input = useSelector((state) => state.input)
  const onValid2 = (title: string, quality: string) => {
    store.dispatch(setTitle(title))
    store.dispatch(setQuality(quality))
  }
  const onValid1 = async (url: string) => {
    store.dispatch(setUrl(url))

    // videoId取得
    // e.g. https://www.bilibili.com/video/BV1pJ411E7Eb
    // -> BV1pJ411E7Eb
    const id = extractId(url)
    if (id) {
      console.log(`Extracted video ID: ${id}`)
      const video = await fetchVideoInfo(id)
      if (video && video.cid !== 0) {
        console.log(`Fetched video info:`, video)
        store.dispatch(setVideo(video))
      }
    }
  }

  const download = async () => {
    await downloadVideo(
      extractId(input.url) ?? '',
      input.title,
      parseInt(input.quality, 10),
    )
  }

  return {
    video,
    input,
    // フォームのバリデーション状態（store上の値をZodで検証）
    isForm1Valid: formSchema1.safeParse({ url: input.url }).success,
    isForm2Valid: formSchema2.safeParse({
      title: input.title,
      quality: input.quality,
    }).success,
    onValid1,
    onValid2,
    download,
  }
}
