import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Sets the native window title for the current page:
 * `{page} - {app}`, prefixed with `(dev) ` when running under the Vite dev
 * server (`tauri dev`) so a dev window stays distinguishable from a release
 * window. Mirrors the Rust-side startup title (`compose_window_title` in
 * window.rs), which carries the same prefix until the first page mounts.
 *
 * Why MODE and not DEV: Vitest runs with MODE='test' while DEV is true there,
 * so DEV would leak the prefix into page tests asserting the exact title.
 */
export function usePageTitle(key: string) {
  const { t } = useTranslation()

  useEffect(() => {
    const devPrefix = import.meta.env.MODE === 'development' ? '(dev) ' : ''
    document.title = `${devPrefix}${t(key)} - ${t('app.title')}`
  }, [t, key])
}
