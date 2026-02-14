import { getCurrentWindow } from '@tauri-apps/api/window'
import { createContext, useContext, useEffect, useState } from 'react'

/**
 * Available theme modes.
 */
type Theme = 'dark' | 'light' | 'system'

/**
 * Props for the ThemeProvider component.
 */
type ThemeProviderProps = {
  /** Child components to be wrapped */
  children: React.ReactNode
  /** Initial theme if no stored value exists. Defaults to 'system'. */
  defaultTheme?: Theme
  /** localStorage key for theme persistence. Defaults to 'vite-ui-theme'. */
  storageKey?: string
}

/**
 * State exposed by the theme context.
 */
type ThemeProviderState = {
  /** Current active theme */
  theme: Theme
  /** Function to update the theme and persist to localStorage */
  setTheme: (theme: Theme) => void
}

/**
 * React context for theme management.
 */
const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined,
)

/**
 * Provides theme management to the application.
 *
 * Manages light/dark/system theme modes with automatic detection of system
 * preference and persistence to localStorage. Applies theme changes to the
 * document root element by adding/removing CSS classes.
 *
 * @param props - Component props
 *
 * @example
 * ```tsx
 * <ThemeProvider defaultTheme="dark" storageKey="app-theme">
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme,
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')

    let effectiveTheme: 'dark' | 'light'
    if (theme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    } else {
      effectiveTheme = theme
    }

    root.classList.add(effectiveTheme)

    // Sync Tauri window theme with the effective theme
    getCurrentWindow()
      .setTheme(effectiveTheme)
      .catch(() => {
        // Ignore errors when running outside Tauri (e.g., browser preview)
      })
  }, [theme])

  const setThemeAndPersist = (newTheme: Theme): void => {
    localStorage.setItem(storageKey, newTheme)
    setTheme(newTheme)
  }

  const value = { theme, setTheme: setThemeAndPersist }

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

/**
 * Hook to access theme state and setter.
 *
 * Must be used within a ThemeProvider component.
 *
 * @returns Theme state and setter function
 * @throws Error if used outside ThemeProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, setTheme } = useTheme()
 *   return <button onClick={() => setTheme('dark')}>Dark Mode</button>
 * }
 * ```
 */
export function useTheme(): ThemeProviderState {
  const context = useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }

  return context
}
