import { AudioForm } from '@/features/audio'
import { PageTemplate } from '@/shared/layout'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Audio extraction page content.
 *
 * Mounted by `PersistentPageLayout` at `/audio`. Header explains the feature;
 * the rest is delegated to {@link AudioForm}.
 */
export function AudioContent() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('audio.title')} - ${t('app.title')}`
  }, [t])

  return (
    <PageTemplate title={t('audio.title')} description={t('audio.description')}>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-2 pb-4 sm:pt-3 sm:pb-6">
        <AudioForm />
      </div>
    </PageTemplate>
  )
}

export default AudioContent
