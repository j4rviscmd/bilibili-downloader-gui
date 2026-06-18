import { ConcatForm } from '@/features/concat'
import { PageTemplate } from '@/shared/layout'
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
    <PageTemplate
      title={t('concat.title')}
      description={t('concat.description')}
    >
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pb-4 sm:pt-3 sm:pb-6">
        <ConcatForm />
      </div>
    </PageTemplate>
  )
}

export default ConcatContent
