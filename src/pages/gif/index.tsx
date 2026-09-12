import { GifForm } from '@/features/gif'
import { PageTemplate } from '@/shared/layout'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * GIF/WebM generator page content.
 *
 * Mounted by `PersistentPageLayout` at `/gif`. Header explains the feature;
 * the rest is delegated to {@link GifForm}.
 */
export function GifContent() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('gif.title')} - ${t('app.title')}`
  }, [t])

  return (
    <PageTemplate title={t('gif.title')} description={t('gif.description')}>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pb-4 sm:pt-3 sm:pb-6">
        <GifForm />
      </div>
    </PageTemplate>
  )
}

export default GifContent
