import { ResolutionForm } from '@/features/resolution'
import { usePageTitle } from '@/shared/hooks/usePageTitle'
import { PageTemplate } from '@/shared/layout'
import { useTranslation } from 'react-i18next'

/**
 * Resolution conversion page content.
 *
 * Mounted by `PersistentPageLayout` at `/resolution`. Header explains the feature;
 * the rest is delegated to {@link ResolutionForm}.
 */
export function ResolutionContent() {
  const { t } = useTranslation()

  usePageTitle('resolution.title')

  return (
    <PageTemplate
      title={t('resolution.title')}
      description={t('resolution.description')}
      bodyScroll
    >
      <div className="pt-2 pb-4 sm:pt-3 sm:pb-6">
        <ResolutionForm />
      </div>
    </PageTemplate>
  )
}

export default ResolutionContent
