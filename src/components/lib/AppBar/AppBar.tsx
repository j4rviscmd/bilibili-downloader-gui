import ToggleThemeButton from '@/features/preference/ToggleThemeButton'

type Props = {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
}

function AppBar({ theme, setTheme }: Props) {
  return (
    <div className="bg-accent flex h-9 w-full items-center justify-between p-3 shadow-md">
      <div />
      <ToggleThemeButton theme={theme} setTheme={setTheme} />
    </div>
  )
}

export default AppBar
