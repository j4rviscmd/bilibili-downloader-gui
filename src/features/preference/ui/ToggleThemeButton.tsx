import { Switch } from '@/shared/animate-ui/radix/switch'
import { Moon, Sun } from 'lucide-react'

/**
 * Props for ToggleThemeButton component.
 */
type Props = {
  /** Current theme mode */
  theme: 'light' | 'dark' | 'system'
  /** Function to update the theme */
  setTheme: (theme: 'light' | 'dark') => void
}

/**
 * Toggle switch for light/dark theme selection.
 *
 * Displays a switch with sun (light) and moon (dark) icons.
 * The switch reflects the current theme and updates it when toggled.
 *
 * @param props - Component props
 *
 * @example
 * ```tsx
 * <ToggleThemeButton theme="dark" setTheme={(t) => console.log(t)} />
 * ```
 */
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
