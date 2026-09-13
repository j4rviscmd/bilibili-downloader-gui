import { TrimForm } from '@/features/trim'
import { PageTemplate } from '@/shared/layout'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Trim page content.
 *
 * Mounted by `PersistentPageLayout` at `/trim`. Header explains the feature;
 * the rest is delegated to {@link TrimForm}.
 */
export function TrimContent() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('trim.title')} - ${t('app.title')}`
  }, [t])

  return (
    <PageTemplate title={t('trim.title')} description={t('trim.description')}>
      {/* Why: pr-5 reserves space so the scrollbar gutter does not overlap
          the flush-right edge of the form sections. */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pr-5 pb-4 sm:pt-3 sm:pb-6">
        <TrimForm />
      </div>
    </PageTemplate>
  )
}

export default TrimContent
