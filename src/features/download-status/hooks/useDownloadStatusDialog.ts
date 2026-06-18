import { useCallback } from 'react'

import { useAppDispatch, useSelector } from '@/app/store'
import {
  closeDownloadStatusDialog,
  openDownloadStatusDialog,
} from '../model/downloadStatusDialogSlice'
import {
  selectActiveParentId,
  selectDownloadStatusDialogOpen,
} from '../model/selectors'

/**
 * ダウンロード状況ダイアログの開閉を扱うフック。
 *
 * `useSettings` の updateOpenDialog パターンを踏襲するが、
 * VideoInfoContext から dispatch できるよう Redux に状態を置いている。
 */
export function useDownloadStatusDialog() {
  const dispatch = useAppDispatch()
  const isOpen = useSelector(selectDownloadStatusDialogOpen)
  const activeParentId = useSelector(selectActiveParentId)

  const open = useCallback(
    (parentId?: string) => {
      dispatch(openDownloadStatusDialog(parentId))
    },
    [dispatch],
  )

  const close = useCallback(() => {
    dispatch(closeDownloadStatusDialog())
  }, [dispatch])

  return { isOpen, activeParentId, open, close }
}
