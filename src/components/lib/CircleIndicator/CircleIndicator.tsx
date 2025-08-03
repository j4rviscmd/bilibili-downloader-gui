import { cn } from '@/lib/utils'

type Props = {
  r?: number
}

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
