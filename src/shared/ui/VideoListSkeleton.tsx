import { Skeleton } from '@/shared/ui/skeleton'

type Props = {
  rows?: number
  label: string
}

export function VideoListSkeleton({ rows = 6, label }: Props) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      <ul aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="py-1">
            <div className="border-border flex items-center gap-3 rounded-lg border p-3">
              <Skeleton className="bg-brand/10 aspect-video h-20 shrink-0 rounded" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Skeleton className="bg-brand/10 h-4 w-full" />
                <Skeleton className="bg-brand/10 h-3 w-2/3" />
                <Skeleton className="bg-brand/10 h-3 w-1/3" />
              </div>
              <Skeleton className="bg-brand/10 h-8 w-28 shrink-0 rounded-md" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
