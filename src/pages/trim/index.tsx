import { TrimForm } from '@/features/trim'
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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border shrink-0 border-b p-3">
        <h1 className="text-xl font-semibold">{t('trim.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('trim.description')}
        </p>
      </div>
      <div className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-4 pt-2 pb-4 sm:px-6 sm:pt-3 sm:pb-6">
        <TrimForm />
      </div>
    </div>
  )
}

export default TrimContent
