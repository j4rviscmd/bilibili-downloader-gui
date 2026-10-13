import { TrimForm } from '@/features/trim'
import { usePageTitle } from '@/shared/hooks/usePageTitle'
import { PageTemplate } from '@/shared/layout'
import { useTranslation } from 'react-i18next'

/**
 * Trim page content.
 *
 * Mounted by `PersistentPageLayout` at `/trim`. Header explains the feature;
 * the rest is delegated to {@link TrimForm}.
 */
export function TrimContent() {
  const { t } = useTranslation()

  usePageTitle('trim.title')

  return (
    <PageTemplate
      title={t('trim.title')}
      description={t('trim.description')}
      bodyScroll
    >
      <div className="pt-2 pb-4 sm:pt-3 sm:pb-6">
        <TrimForm />
      </div>
    </PageTemplate>
  )
}

export default TrimContent
