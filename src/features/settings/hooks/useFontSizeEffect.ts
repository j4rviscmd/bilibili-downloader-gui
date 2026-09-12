import { useSelector } from '@/app/store'
import { applyFontSize, parseFontSize } from '@/features/settings/lib/fontSize'
import { useEffect } from 'react'

/**
 * Keeps the document root font-size in sync with the settings store.
 *
 * Mirrors `useThemeEffect`: any store update applies immediately — most
 * importantly the settings page's became-visible re-fetch (issue #560
 * multi-instance), where a parallel app instance changed `fontSize` and
 * the slider value updated but the rem-based UI did not (no DOM write
 * existed on that path; only the slider handler and app init applied it).
 */
export function useFontSizeEffect() {
  const fontSize = useSelector((state) => state.settings.fontSize)

  useEffect(() => {
    applyFontSize(parseFontSize(fontSize))
  }, [fontSize])
}
