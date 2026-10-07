import { RotationForm } from '@/features/rotation'
import { usePageTitle } from '@/shared/hooks/usePageTitle'
import { PageTemplate } from '@/shared/layout'
import { useTranslation } from 'react-i18next'

/**
 * Rotation page content.
 *
 * Mounted by `PersistentPageLayout` at `/rotation`. Header explains the feature;
 * the rest is delegated to {@link RotationForm}.
 */
export function RotationContent() {
  const { t } = useTranslation()

  usePageTitle('rotation.title')

  return (
    <PageTemplate
      title={t('rotation.title')}
      description={t('rotation.description')}
    >
      {/* Why: pr-5 reserves space so the scrollbar gutter does not overlap
          the flush-right edge of the form sections. */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pr-5 pb-4 sm:pt-3 sm:pb-6">
        <RotationForm />
      </div>
    </PageTemplate>
  )
}

export default RotationContent
