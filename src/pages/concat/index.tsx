import { ConcatForm } from '@/features/concat'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Page-level component for the video concatenation feature.
 *
 * Sets the document title and renders the header (title + description)
 * along with the {@link ConcatForm} inside a scrollable content area.
 */
export function ConcatContent() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('concat.title')} - ${t('app.title')}`
  }, [t])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border shrink-0 border-b p-3">
        <h1 className="text-xl font-semibold">{t('concat.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('concat.description')}
        </p>
      </div>
      <div className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-4 pt-2 pb-4 sm:px-6 sm:pt-3 sm:pb-6">
        <ConcatForm />
      </div>
    </div>
  )
}

export default ConcatContent
