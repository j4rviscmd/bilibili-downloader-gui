import { AudioForm } from '@/features/audio'
import { usePageTitle } from '@/shared/hooks/usePageTitle'
import { PageTemplate } from '@/shared/layout'
import { useTranslation } from 'react-i18next'

/**
 * Audio extraction page content.
 *
 * Mounted by `PersistentPageLayout` at `/audio`. Header explains the feature;
 * the rest is delegated to {@link AudioForm}.
 */
export function AudioContent() {
  const { t } = useTranslation()

  usePageTitle('audio.title')

  return (
    <PageTemplate
      title={t('audio.title')}
      description={t('audio.description')}
      bodyScroll
    >
      <div className="pt-2 pb-4 sm:pt-3 sm:pb-6">
        <AudioForm />
      </div>
    </PageTemplate>
  )
}

export default AudioContent
