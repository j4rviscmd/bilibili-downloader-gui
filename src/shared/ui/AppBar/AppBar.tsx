import ToggleThemeButton from '@/features/preference/ui/ToggleThemeButton'
import { useSettings } from '@/features/settings/useSettings'
import type { User } from '@/features/user'
import { Settings } from '@/shared/animate-ui/icons/settings'
import { Button } from '@/shared/ui/button'
import { useState } from 'react'
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
 * - Settings button (opens settings dialog)
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
  const userName = user.data.uname
  const { t } = useTranslation()
  const { updateOpenDialog } = useSettings()
  const [hover, setHover] = useState(false)

  // Mask last 3 characters of the user ID for display
  const maskedUserName = maskUserName(userName)

  return (
    <div className="bg-accent box-border flex h-9 w-full items-center justify-between px-3 shadow-md sm:mx-auto sm:max-w-7xl sm:px-6">
      <div>
        <span className="text-muted-foreground">
          {t('app.logged_in_user')}:
        </span>
        <span title={userName} className="px-3">
          {maskedUserName}
        </span>
      </div>
      <div className="flex items-center">
        <ToggleThemeButton theme={theme} setTheme={setTheme} />
        <div className="mx-1.5" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => updateOpenDialog(true)}
          aria-label="Open settings"
        >
          <Settings animate={hover} size={18} />
        </Button>
      </div>
    </div>
  )
}

export default AppBar
