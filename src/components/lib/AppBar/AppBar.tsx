import ToggleThemeButton from '@/features/preference/ToggleThemeButton'
import type { User } from '@/shared/user'

type Props = {
  user: User
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark') => void
}

function AppBar({ user, theme, setTheme }: Props) {
  const userName = user.data.uname

  return (
    <div className="bg-accent box-border flex h-9 w-full items-center justify-between p-3 shadow-md">
      <div>
        <span className="text-muted-foreground">ログインユーザ:</span>
        <span className="px-3">{userName}</span>
      </div>
      <ToggleThemeButton theme={theme} setTheme={setTheme} />
    </div>
  )
}

export default AppBar
