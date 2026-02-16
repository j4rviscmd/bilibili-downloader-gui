import { Skeleton } from '@/shared/ui/skeleton'

/**
 * Skeleton component for VideoPartCard.
 *
 * Displayed while video info is being fetched.
 * Mimics the layout of VideoPartCard with placeholder elements.
 */
function VideoPartCardSkeleton() {
  return (
    <div className="p-3 md:p-4">
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="size-6 rounded" />
          <Skeleton className="h-16 w-24 rounded-lg md:h-20 md:w-32" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-[52px] w-full rounded-md" />
          </div>
        </div>
        <div
          className="mt-1.5 flex items-center gap-2"
          style={{ marginLeft: '2.25rem' }}
        >
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center space-x-2">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center space-x-2">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default VideoPartCardSkeleton
