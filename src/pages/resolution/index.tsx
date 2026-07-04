import { ResolutionForm } from '@/features/resolution'
import { PageTemplate } from '@/shared/layout'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Resolution conversion page content.
 *
 * Mounted by `PersistentPageLayout` at `/resolution`. Header explains the feature;
 * the rest is delegated to {@link ResolutionForm}.
 */
export function ResolutionContent() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('resolution.title')} - ${t('app.title')}`
  }, [t])

  return (
    <PageTemplate title={t('resolution.title')} description={t('resolution.description')}>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pb-4 sm:pt-3 sm:pb-6">
        <ResolutionForm />
      </div>
    </PageTemplate>
  )
}

export default ResolutionContent
