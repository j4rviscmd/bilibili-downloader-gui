import { Switch } from '@/shared/animate-ui/radix/switch'
import { Moon, Sun } from 'lucide-react'

type Props = {
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark') => void
}

function ToggleThemeButton({ theme, setTheme }: Props) {
  const onChange = (value: boolean) => {
    setTheme(value ? 'dark' : 'light')
  }
  return (
    <Switch
      checked={theme === 'dark'}
      onCheckedChange={onChange}
      leftIcon={<Sun />}
      rightIcon={<Moon />}
    />
  )
}

export default ToggleThemeButton
