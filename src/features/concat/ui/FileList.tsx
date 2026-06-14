import { SortableItem } from './SortableItem'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

type FileListProps = {
  /** Absolute file paths to display in the list. */
  files: string[]
  /** Whether a concatenation operation is in progress (disables interaction). */
  isProcessing: boolean
  /** Callback invoked with the index of the file to remove. */
  onRemove: (index: number) => void
  /** Callback invoked with `(fromIndex, toIndex)` when a file is reordered via drag-and-drop. */
  onReorder: (fromIndex: number, toIndex: number) => void
}

/**
 * Drag-and-drop sortable list of video files.
 *
 * Wraps `@dnd-kit` to provide vertical-axis-only reordering.
 * Each item is rendered as a {@link SortableItem}.
 */
export function FileList({
  files,
  isProcessing,
  onRemove,
  onReorder,
}: FileListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  /** Resolves the source and target indices from the drag event and calls `onReorder`. */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const fromIndex = files.findIndex((f) => f === active.id)
      const toIndex = files.findIndex((f) => f === over.id)
      if (fromIndex !== -1 && toIndex !== -1) {
        onReorder(fromIndex, toIndex)
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext items={files} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1">
          {files.map((path, index) => (
            <SortableItem
              key={path}
              id={path}
              path={path}
              index={index}
              onRemove={() => onRemove(index)}
              disabled={isProcessing}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
