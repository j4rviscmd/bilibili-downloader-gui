import * as React from 'react'

/**
 * Breakpoint pixel width for mobile detection.
 */
const MOBILE_BREAKPOINT = 768

/**
 * Hook to detect if the viewport is mobile size.
 *
 * Uses a media query to detect screen width < 768px.
 * Updates dynamically when the viewport is resized.
 *
 * @returns True if viewport width is less than 768px, false otherwise
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const isMobile = useIsMobile()
 *   return <div>{isMobile ? 'Mobile' : 'Desktop'}</div>
 * }
 * ```
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}
