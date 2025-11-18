import { store, useSelector } from '@/app/store'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { fetchVideoInfo } from '@/features/video/api/fetchVideoInfo'
import {
  buildVideoFormSchema1,
  buildVideoFormSchema2,
} from '@/features/video/formSchema'
import {
  initPartInputs,
  setUrl,
  updatePartInputByIndex,
} from '@/features/video/inputSlice'
import { selectDuplicateIndices } from '@/features/video/selectors'
import { setVideo } from '@/features/video/videoSlice'
import { enqueue } from '@/shared/queue/queueSlice'
import { useEffect, useRef } from 'react'
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

  const initInputsForVideo = (v: typeof video) => {
    const partInputs = v.parts.map((p) => ({
      cid: p.cid,
      page: p.page,
      title: `${v.title}_${p.part}`,
      quality: (p.qualities[0]?.id || 80).toString(),
    }))
    store.dispatch(initPartInputs(partInputs))
  }

  const onValid2 = (index: number, title: string, quality: string) => {
    store.dispatch(updatePartInputByIndex({ index, title, quality }))
  }

  const onValid1 = async (url: string) => {
    store.dispatch(setUrl(url))
    const id = extractId(url)
    if (id) {
      const v = await fetchVideoInfo(id)
      if (v && v.parts.length > 0 && v.parts[0].cid !== 0) {
        store.dispatch(setVideo(v))
        initInputsForVideo(v)
      }
    }
  }

  // Validation
  const schema1 = buildVideoFormSchema1(t)
  const schema2 = buildVideoFormSchema2(t)
  const isForm1Valid = schema1.safeParse({ url: input.url }).success

  const partValidFlags = input.partInputs.map(
    (pi) => schema2.safeParse({ title: pi.title, quality: pi.quality }).success,
  )
  const duplicateIndices = useSelector(selectDuplicateIndices)
  const hasDuplicates = duplicateIndices.length > 0
  // Toast throttle local to this hook instance
  const dupToastRef = useRef(false)
  useEffect(() => {
    if (hasDuplicates && !dupToastRef.current) {
      toast.error(t('video.duplicate_titles'), { duration: 5000 })
      dupToastRef.current = true
    } else if (!hasDuplicates && dupToastRef.current) {
      dupToastRef.current = false
    }
  }, [hasDuplicates, t])
  const isForm2ValidAll =
    input.partInputs.length > 0 &&
    partValidFlags.every((f) => f) &&
    !hasDuplicates

  const download = async () => {
    try {
      if (!isForm1Valid || !isForm2ValidAll) return
      const videoId = (extractId(input.url) ?? '').trim()
      if (!videoId) return
      // Parent ID
      const parentId = `${videoId}-${Date.now()}`
      // Enqueue parent (placeholder filename = video.title)
      store.dispatch(
        enqueue({
          downloadId: parentId,
          filename: video.title,
          status: 'pending',
        }),
      )
      // Child downloads: sequential order by parts
      for (let i = 0; i < input.partInputs.length; i++) {
        const pi = input.partInputs[i]
        await downloadVideo(
          videoId,
          pi.cid,
          pi.title.trim(),
          parseInt(pi.quality, 10),
          `${parentId}-p${i + 1}`,
          parentId,
        )
      }
    } catch (e) {
      const raw = String(e)
      let messageKey: string | null = null
      if (raw.includes('ERR::FILE_EXISTS')) messageKey = 'video.file_exists'
      if (!messageKey && raw.includes('ERR::DISK_FULL'))
        messageKey = 'video.disk_full'
      const description = messageKey ? t(messageKey) : raw
      toast.error(t('video.download_failed'), {
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
    onValid1,
    onValid2,
    isForm1Valid,
    isForm2ValidAll,
    duplicateIndices,
    download,
  }
}
