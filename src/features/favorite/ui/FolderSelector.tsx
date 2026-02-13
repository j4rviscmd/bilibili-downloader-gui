import type { FavoriteFolder } from '@/features/favorite/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/** Bilibili API default folder name (Chinese). */
const DEFAULT_FOLDER_API_NAME = '默认收藏夹'

type Props = {
  folders: FavoriteFolder[]
  selectedId: number | null
  onSelect: (id: number) => void
  loading?: boolean
}

/**
 * Folder selector dropdown component.
 */
function FolderSelector({ folders, selectedId, onSelect, loading }: Props) {
  const { t } = useTranslation()

  /** Replace API default folder name with i18n label. */
  const displayName = useCallback(
    (title: string) =>
      title === DEFAULT_FOLDER_API_NAME ? t('favorite.defaultFolder') : title,
    [t],
  )

  if (loading) {
    return (
      <div className="text-muted-foreground animate-pulse text-sm">
        {t('init.initializing')}
      </div>
    )
  }

  if (folders.length === 0) {
    return null
  }

  return (
    <Select
      value={selectedId?.toString() ?? ''}
      onValueChange={(value: string) => onSelect(Number(value))}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder={t('favorite.selectFolder')} />
      </SelectTrigger>
      <SelectContent>
        {folders.map((folder) => (
          <SelectItem key={folder.id} value={folder.id.toString()}>
            <div className="flex items-center gap-2">
              <span>{displayName(folder.title)}</span>
              <span className="text-muted-foreground text-xs">
                ({folder.mediaCount})
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default FolderSelector
