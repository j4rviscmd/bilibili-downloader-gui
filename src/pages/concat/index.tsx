import { ConcatForm } from '@/features/concat'
import { PageTemplate } from '@/shared/layout'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Page-level component for the video concatenation feature.
 *
 * Sets the document title and renders the header (title + description)
 * along with the {@link ConcatForm}. The wrapper is a non-scrolling flex
 * column that passes the bounded page height down; ConcatForm owns its
 * own internal scroll region for the file list (issue #461).
 */
export function ConcatContent() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('concat.title')} - ${t('app.title')}`
  }, [t])

  return (
    <PageTemplate
      title={t('concat.title')}
      description={t('concat.description')}
    >
      {/*
        Caution: do NOT re-add `overflow-y-auto` here to match sibling pages
        (trim/audio/resolution). This wrapper intentionally stays a
        non-scrolling flex column so the bounded height flows into
        ConcatForm, whose action row is pinned via `shrink-0`; whole-body
        scroll would push those buttons off-screen (issue #461).
      */}
      <div className="flex min-h-0 flex-1 flex-col pt-2 pb-4 sm:pt-3 sm:pb-6">
        <ConcatForm />
      </div>
    </PageTemplate>
  )
}

export default ConcatContent
