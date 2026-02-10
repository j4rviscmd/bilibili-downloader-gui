import ToggleThemeButton from '@/features/preference/ui/ToggleThemeButton'
import type { User } from '@/features/user'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GitHubStars } from '@/shared/ui/GitHubStars'

/**
 * Masks the last 3 characters of a username for privacy.
 *
 * Replaces the last 3 characters with asterisks. If the username is
 * 3 characters or less, masks all characters.
 *
 * @param userName - The username to mask
 * @returns The masked username (e.g., "user***" or "***")
 */
function maskUserName(userName: string | undefined): string {
  if (!userName) return ''
  if (userName.length <= 3) return '*'.repeat(userName.length)
  return userName.slice(0, -3) + '***'
}

type Props = {
  readonly user: User
  readonly theme: 'light' | 'dark' | 'system'
  readonly setTheme: (theme: 'light' | 'dark') => void
}

/**
 * Application top bar component.
 *
 * Displays:
 * - Logged-in username (masked for privacy)
 * - GitHub repository stars (with caching)
 * - Theme toggle button
 */
function AppBar({ user, theme, setTheme }: Props) {
  const { t } = useTranslation()

  const maskedUserName = user.data.isLogin ? maskUserName(user.data.uname) : ''
  const hasUsername = user.data.isLogin && user.data.uname

  return (
    <div className="bg-accent box-border flex h-9 w-full items-center justify-between px-3 sm:mx-auto sm:max-w-7xl sm:px-6">
      <div className="flex items-center gap-2">
        <UserRound
          className="text-muted-foreground size-4"
          aria-hidden="true"
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-sm">
                {maskedUserName || t('user.not_logged_in')}
              </span>
            </TooltipTrigger>
            {hasUsername && (
              <TooltipContent>
                <p>{user.data.uname}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-3">
        <GitHubStars owner="j4rviscmd" repo="bilibili-downloader-gui" />
        <ToggleThemeButton theme={theme} setTheme={setTheme} />
      </div>
    </div>
  )
}

export default AppBar
