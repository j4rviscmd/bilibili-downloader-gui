import ToggleThemeButton from '@/features/preference/ui/ToggleThemeButton'
import LanguagesDropdown from '@/features/settings/LanguagesDropdown'
import type { User } from '@/features/user'
import { useTranslation } from 'react-i18next'

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
 * - Language selection dropdown
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
  // Mask last 3 characters of the user ID for display
  const maskedUserName = (() => {
    if (!userName) return ''
    if (userName.length <= 3) return '*'.repeat(userName.length)
    return userName.slice(0, -3) + '***'
  })()

  return (
    <div className="bg-accent box-border flex h-9 w-full items-center justify-between p-3 shadow-md">
      <div>
        <span className="text-muted-foreground">
          {t('app.logged_in_user')}:
        </span>
        <span title={userName} className="px-3">
          {maskedUserName}
        </span>
      </div>
      <div className="flex items-center">
        <LanguagesDropdown />
        <div className="mx-1.5" />
        <ToggleThemeButton theme={theme} setTheme={setTheme} />
      </div>
    </div>
  )
}

export default AppBar
