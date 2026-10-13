import { GifForm } from '@/features/gif'
import { usePageTitle } from '@/shared/hooks/usePageTitle'
import { PageTemplate } from '@/shared/layout'
import { useTranslation } from 'react-i18next'

/**
 * GIF/WebM generator page content.
 *
 * Mounted by `PersistentPageLayout` at `/gif`. Header explains the feature;
 * the rest is delegated to {@link GifForm}.
 */
export function GifContent() {
  const { t } = useTranslation()

  usePageTitle('gif.title')

  return (
    <PageTemplate
      title={t('gif.title')}
      description={t('gif.description')}
      bodyScroll
    >
      <div className="pt-2 pb-4 sm:pt-3 sm:pb-6">
        <GifForm />
      </div>
    </PageTemplate>
  )
}

export default GifContent
