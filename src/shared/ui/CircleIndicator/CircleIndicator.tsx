import { cn } from '@/shared/lib/utils'
import { Loader2 } from 'lucide-react'

/** Props for the CircleIndicator component. */
type Props = {
  /** Size variant: 'sm' (16px), 'md' (24px), or 'lg' (32px). */
  size?: 'sm' | 'md' | 'lg'
  /** Additional CSS class names to apply. */
  className?: string
}

/** Tailwind CSS class mapping for each size variant. */
const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
} as const

/**
 * Circular loading spinner using lucide-react Loader2 icon.
 *
 * @param size - 'sm' (16px), 'md' (24px), or 'lg' (32px). Defaults to 'lg'.
 * @param className - Additional CSS classes.
 */
export default function CircleIndicator({ size = 'lg', className }: Props) {
  return (
    <Loader2
      className={cn(
        'text-muted-foreground animate-spin',
        sizeClasses[size],
        className,
      )}
    />
  )
}
