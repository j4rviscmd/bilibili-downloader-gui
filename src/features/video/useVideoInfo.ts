import { store, useSelector } from '@/app/store'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'
import {
  buildVideoFormSchema1,
  buildVideoFormSchema2,
} from '@/features/video/formSchema'
import { setQuality, setTitle, setUrl } from '@/features/video/inputSlice'
import { setVideo } from '@/features/video/videoSlice'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const extractId = (url: string) => {
  const match = url.match(/\/video\/([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

export const useVideoInfo = () => {
  const { t } = useTranslation()
  const progress = useSelector((state) => state.progress)
  const video = useSelector((state) => state.video)
  const input = useSelector((state) => state.input)
  const onValid2 = (title: string, quality: string) => {
    store.dispatch(setTitle(title))
    store.dispatch(setQuality(quality))
  }
  const onValid1 = async (url: string) => {
    store.dispatch(setUrl(url))
    // Disabled: avoid persisting URL to localStorage
    // localStorage.setItem(VIDEO_URL_KEY, url)

    // videoId取得
    // e.g. https://www.bilibili.com/video/BV1pJ411E7Eb
    // -> BV1pJ411E7Eb
    const id = extractId(url)
    if (id) {
      console.log(`Extracted video ID: ${id}`)
      const video = await fetchVideoInfo(id)
      if (video && video.parts.length > 0 && video.parts[0].cid !== 0) {
        console.log(`Fetched video info:`, video)
        store.dispatch(setVideo(video))
      }
    }
  }

  const download = async () => {
    try {
      await downloadVideo(
        (extractId(input.url) ?? '').trim(),
        input.title.trim(),
        parseInt(input.quality, 10),
      )
    } catch (e) {
      const raw = String(e)
      // Standardized backend error codes: ERR::<CODE>
      let messageKey: string | null = null
      if (raw.includes('ERR::FILE_EXISTS')) {
        messageKey = 'video.file_exists'
      }
      if (!messageKey && raw.includes('ERR::DISK_FULL')) {
        messageKey = 'video.disk_full'
      }
      const description = messageKey ? t(messageKey) : raw
      toast.error(t('video.download_failed'), {
        // Keep the error toast persistent until user closes it
        duration: Infinity,
        description,
        closeButton: true,
      })
      console.error('Download failed:', raw)
    }
  }

  return {
    progress,
    video,
    input,
    // フォームのバリデーション状態（store上の値をZodで検証）
    isForm1Valid: buildVideoFormSchema1(t).safeParse({ url: input.url })
      .success,
    isForm2Valid: buildVideoFormSchema2(t).safeParse({
      title: input.title,
      quality: input.quality,
    }).success,
    onValid1,
    onValid2,
    download,
  }
}
