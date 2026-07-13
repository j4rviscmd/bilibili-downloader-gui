import { RotationForm } from '@/features/rotation'
import { PageTemplate } from '@/shared/layout'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Rotation page content.
 *
 * Mounted by `PersistentPageLayout` at `/rotation`. Header explains the feature;
 * the rest is delegated to {@link RotationForm}.
 */
export function RotationContent() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('rotation.title')} - ${t('app.title')}`
  }, [t])

  return (
    <PageTemplate
      title={t('rotation.title')}
      description={t('rotation.description')}
    >
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pb-4 sm:pt-3 sm:pb-6">
        <RotationForm />
      </div>
    </PageTemplate>
  )
}

export default RotationContent
