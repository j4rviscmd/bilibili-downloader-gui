import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type SortableItemProps = {
  /** Unique identifier used by `@dnd-kit` for sorting (typically the file path). */
  id: string
  /** Absolute file path displayed in the item. */
  path: string
  /** 0-based position index shown as a numbered label. */
  index: number
  /** Callback invoked when the remove button is clicked. */
  onRemove: () => void
  /** Whether drag-and-drop and remove interactions are disabled. */
  disabled: boolean
}

/**
 * A single draggable row in the file list.
 *
 * Renders a grip handle, position number, truncated file name, and a
 * remove button. Uses `useSortable` from `@dnd-kit` to manage drag state.
 */
export function SortableItem({
  id,
  path,
  index,
  onRemove,
  disabled,
}: SortableItemProps) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const filename = path.split(/[\\/]/).pop() ?? path

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-background flex items-center gap-2 rounded-md border px-2 py-1.5"
    >
      <button
        type="button"
        className="text-muted-foreground cursor-grab touch-none active:cursor-grabbing"
        disabled={disabled}
        aria-label={t('concat.dragToReorderAria', {
          index: index + 1,
        })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="text-muted-foreground w-5 shrink-0 text-xs tabular-nums">
        {index + 1}.
      </span>
      <p
        className="text-foreground min-w-0 flex-1 truncate text-sm"
        title={path}
      >
        {filename}
      </p>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label={t('concat.removeFileAria', { filename })}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
