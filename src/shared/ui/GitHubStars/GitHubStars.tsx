import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import {
  getCachedStars,
  setCachedStars,
  isCacheValid,
} from '@/shared/lib/githubStarsCache'
import { GitHubIcon } from './GitHubIcon'

type Props = {
  /** Repository owner (e.g., "j4rviscmd") */
  readonly owner: string
  /** Repository name (e.g., "bilibili-downloader-gui") */
  readonly repo: string
  /** Additional CSS classes to apply */
  readonly className?: string
}

/**
 * Formats a number into a compact string representation.
 *
 * - Numbers >= 1000 are formatted as "X.Xk" (e.g., 1234 -> "1.2k")
 * - Numbers < 1000 are returned as-is
 *
 * @param count - The number to format
 * @returns Formatted string (e.g., "1.2k", "999")
 */
function formatNumber(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`
  }
  return count.toString()
}

/**
 * GitHub Stars component with caching.
 *
 * Displays the star count for a GitHub repository with:
 * - LocalStorage caching (1 hour TTL) to avoid API rate limits
 * - Loading state during fetch
 * - Link to stargazers page
 * - Tooltip with i18n support
 * - Automatic cleanup on unmount
 *
 * @example
 * ```tsx
 * import { GitHubStars } from '@/shared/ui/GitHubStars'
 *
 * function AppBar() {
 *   return (
 *     <GitHubStars owner="j4rviscmd" repo="bilibili-downloader-gui" />
 *   )
 * }
 * ```
 */
export function GitHubStars({ owner, repo, className = '' }: Props) {
  const { t } = useTranslation()
  const [stars, setStars] = useState<number | null>(() =>
    getCachedStars(owner, repo),
  )
  const [isLoading, setIsLoading] = useState(() => !isCacheValid(owner, repo))

  useEffect(() => {
    if (isCacheValid(owner, repo)) {
      return
    }

    let aborted = false

    invoke<number>('get_repo_stars', { owner, repo })
      .then((count) => {
        if (aborted) return
        setStars(count)
        setCachedStars(owner, repo, count)
      })
      .catch(() => {
        if (aborted) return
        // Keep cached value on error, or null if no cache
      })
      .finally(() => {
        if (!aborted) setIsLoading(false)
      })

    return () => {
      aborted = true
    }
  }, [owner, repo])

  const starsLabel = t('github.stars', { count: stars ?? 0 })
  const tooltipContent = stars ? starsLabel : t('github.repo')

  const displayStars = isLoading
    ? '---'
    : stars !== null
      ? formatNumber(stars)
      : '---'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={`https://github.com/${owner}/${repo}/stargazers`}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors ${className}`}
            aria-label={tooltipContent}
          >
            <GitHubIcon className="size-4" />
            <Star className="size-4 fill-current" aria-hidden="true" />
            <span className={isLoading ? 'opacity-50' : ''}>{displayStars}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
