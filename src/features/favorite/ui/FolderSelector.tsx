import type { FavoriteFolder } from '@/features/favorite/types'
import CircleIndicator from '@/shared/ui/CircleIndicator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useTranslation } from 'react-i18next'

/** Bilibili API default folder name (Chinese). */
const DEFAULT_FOLDER_API_NAME = '默认收藏夹'

/** Props for the FolderSelector component. */
type Props = {
  /** Array of favorite folders to display in the dropdown. */
  folders: FavoriteFolder[]
  /** ID of the currently selected folder, or null if none is selected. */
  selectedId: number | null
  /** Callback invoked when the user selects a folder from the dropdown. */
  onSelect: (id: number) => void
  /** Whether folder data is currently being fetched. */
  loading?: boolean
}

/**
 * Replace the Bilibili API default folder name with a localized label.
 *
 * The Bilibili API returns a Chinese string for the default folder.
 * This function swaps it with the localized default folder name from i18n.
 *
 * @param title - The raw folder title returned by the Bilibili API.
 * @param localizedDefault - The localized label for the default folder
 *   (e.g., the value of the `favorite.defaultFolder` translation key).
 * @returns The localized display name for the folder.
 */
function getDisplayName(title: string, localizedDefault: string): string {
  return title === DEFAULT_FOLDER_API_NAME ? localizedDefault : title
}

/**
 * Folder selector dropdown component for choosing a favorite folder.
 *
 * Displays a Select dropdown populated with the user's favorite folders.
 * Each item shows the folder name (with the API default folder name localized)
 * and the media count. Shows a loading spinner while folders are being fetched,
 * and renders nothing when the folder list is empty.
 *
 * @example
 * ```tsx
 * <FolderSelector
 *   folders={folders}
 *   selectedId={selectedFolderId}
 *   onSelect={(id) => setSelectedFolder(id)}
 *   loading={foldersLoading}
 * />
 * ```
 */
function FolderSelector({ folders, selectedId, onSelect, loading }: Props) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="flex items-center">
        <CircleIndicator size="sm" />
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
              <span>
                {getDisplayName(folder.title, t('favorite.defaultFolder'))}
              </span>
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
