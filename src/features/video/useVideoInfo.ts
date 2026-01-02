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
import { setError } from '@/shared/downloadStatus/downloadStatusSlice'
import { enqueue } from '@/shared/queue/queueSlice'
import { useEffect, useRef, useState } from 'react'
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
  const [isFetching, setIsFetching] = useState(false)

  const initInputsForVideo = (v: typeof video) => {
    const partInputs = v.parts.map((p) => ({
      cid: p.cid,
      page: p.page,
      title: v.title,
      videoQuality: (p.videoQualities[0]?.id || 80).toString(),
      audioQuality: (p.audioQualities[0]?.id || 30216).toString(),
      selected: true,
    }))
    store.dispatch(initPartInputs(partInputs))
  }

  const onValid2 = (
    index: number,
    title: string,
    videoQuality: string,
    audioQuality?: string,
  ) => {
    store.dispatch(
      updatePartInputByIndex({
        index,
        title,
        videoQuality,
        ...(audioQuality ? { audioQuality } : {}),
      }),
    )
  }

  const onValid1 = async (url: string) => {
    store.dispatch(setUrl(url))
    const id = extractId(url)
    if (id) {
      setIsFetching(true)
      try {
        const v = await fetchVideoInfo(id)
        if (v && v.parts.length > 0 && v.parts[0].cid !== 0) {
          console.log('Fetched video info:', v)
          store.dispatch(setVideo(v))
          initInputsForVideo(v)
        }
      } finally {
        setIsFetching(false)
      }
    }
  }

  // Validation
  const schema1 = buildVideoFormSchema1(t)
  const schema2 = buildVideoFormSchema2(t)
  const isForm1Valid = schema1.safeParse({ url: input.url }).success

  const partValidFlags = input.partInputs.map(
    (pi) =>
      schema2.safeParse({
        title: pi.title,
        videoQuality: pi.videoQuality,
        audioQuality: pi.audioQuality,
      }).success,
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
  // 選択されたパートの数をカウント
  const selectedCount = input.partInputs.filter((pi) => pi.selected).length

  const isForm2ValidAll =
    input.partInputs.length > 0 &&
    partValidFlags.every((f) => f) &&
    !hasDuplicates &&
    selectedCount > 0

  const download = async () => {
    try {
      if (!isForm1Valid || !isForm2ValidAll) return
      const videoId = (extractId(input.url) ?? '').trim()
      if (!videoId) return
      // Parent ID
      const parentId = `${videoId}-${Date.now()}`
      // Analytics: record click
      // NOTE: GA4 Analytics は無効化されています
      // await invoke<void>('record_download_click', { downloadId: parentId })
      // Enqueue parent (placeholder filename = video.title)
      store.dispatch(
        enqueue({
          downloadId: parentId,
          filename: video.title,
          status: 'pending',
        }),
      )
      // Child downloads: sequential order by selected parts only
      const selectedParts = input.partInputs
        .map((pi, idx) => ({ pi, idx }))
        .filter(({ pi }) => pi.selected)
      for (let i = 0; i < selectedParts.length; i++) {
        const { pi, idx } = selectedParts[i]
        await downloadVideo(
          videoId,
          pi.cid,
          pi.title.trim(),
          parseInt(pi.videoQuality, 10),
          parseInt(pi.audioQuality, 10),
          `${parentId}-p${idx + 1}`,
          parentId,
        )
      }
    } catch (e) {
      const raw = String(e)
      let messageKey: string | null = null
      const errorMap: Record<string, string> = {
        'ERR::FILE_EXISTS': 'video.file_exists',
        'ERR::DISK_FULL': 'video.disk_full',
        'ERR::MERGE_FAILED': 'video.merge_failed',
        'ERR::QUALITY_NOT_FOUND': 'video.quality_not_found',
        'ERR::COOKIE_MISSING': 'video.cookie_missing',
      }
      for (const code in errorMap) {
        if (raw.includes(code)) {
          messageKey = errorMap[code]
          break
        }
      }
      if (!messageKey && raw.includes('ERR::NETWORK::')) {
        messageKey = 'video.network_error'
      }
      const description = messageKey ? t(messageKey) : raw
      toast.error(t('video.download_failed'), {
        duration: Infinity,
        description,
        closeButton: true,
      })
      console.error('Download failed:', raw)
      store.dispatch(setError(description))
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
    selectedCount,
    isFetching,
    download,
  }
}
