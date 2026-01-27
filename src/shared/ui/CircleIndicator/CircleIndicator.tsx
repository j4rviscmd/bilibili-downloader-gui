import { cn } from '@/shared/lib/utils'

/**
 * Props for CircleIndicator component.
 */
type Props = {
  /** Radius of the spinner in pixels. Defaults to 30. */
  r?: number
}

/**
 * Animated circular loading spinner.
 *
 * Displays a spinning circle with a transparent top border to create
 * the loading animation effect.
 *
 * @param props - Component props
 *
 * @example
 * ```tsx
 * <CircleIndicator r={20} /> // Small spinner
 * <CircleIndicator /> // Default size (r=30)
 * ```
 */
export default function CircleIndicator({ r = 30 }: Props) {
  return (
    <div className="flex justify-center p-3">
      <div
        className={cn(
          'animate-spin rounded-full border-4 border-blue-500 border-t-transparent',
        )}
        style={{ width: r * 2, height: r * 2 }}
      />
    </div>
  )
}
