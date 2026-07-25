import { Button } from '@/shared/ui/button'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AboutDialogContent } from './AboutDialogContent'

/**
 * Settings-screen trigger for the About dialog.
 *
 * Renders the "About" button and owns the open state; the dialog body
 * itself lives in {@link AboutDialogContent} so the macOS menu-bar entry
 * can reuse the exact same content.
 *
 * @example
 * ```tsx
 * <AboutDialog />
 * ```
 */
export function AboutDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Info className="mr-2 size-4" />
        {t('about.button')}
      </Button>

      <AboutDialogContent open={open} onOpenChange={setOpen} />
    </>
  )
}
