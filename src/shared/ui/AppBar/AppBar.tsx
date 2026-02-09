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

/**
 * Mask the last 3 characters of a username for privacy.
 *
 * @param userName - The username to mask
 * @returns The masked username
 */
function maskUserName(userName: string | undefined): string {
  if (!userName) return ''
  if (userName.length <= 3) return '*'.repeat(userName.length)
  return userName.slice(0, -3) + '***'
}

/**
 * Props for AppBar component.
 */
type Props = {
  /** Current user information */
  user: User
  /** Current theme mode */
  theme: 'light' | 'dark' | 'system'
  /** Function to update the theme */
  setTheme: (theme: 'light' | 'dark') => void
}

/**
 * Application top bar component.
 *
 * Displays:
 * - Logged-in username (masked for privacy)
 * - Theme toggle button
 *
 * @param props - Component props
 *
 * @example
 * ```tsx
 * <AppBar user={userData} theme="dark" setTheme={(t) => console.log(t)} />
 * ```
 */
function AppBar({ user, theme, setTheme }: Props) {
  const { t } = useTranslation()

  const maskedUserName = user.data.isLogin ? maskUserName(user.data.uname) : ''

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
            {user.data.isLogin && user.data.uname && (
              <TooltipContent>
                <p>{user.data.uname}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex items-center">
        <ToggleThemeButton theme={theme} setTheme={setTheme} />
      </div>
    </div>
  )
}

export default AppBar
