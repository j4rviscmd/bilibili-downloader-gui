import { fetchAllReleaseNotes } from '@/features/updater'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import { logger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/button'
import { FileText } from 'lucide-react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const REPO_OWNER = 'j4rviscmd'
const REPO_NAME = 'bilibili-downloader-gui'

type MdProps = { children?: React.ReactNode }

/**
 * Custom renderers for ReactMarkdown that apply Tailwind CSS
 * classes to each Markdown element for consistent styling
 * within the release notes dialog.
 */
const markdownComponents = {
  h1: ({ children }: MdProps) => (
    <h1 className="mb-4 text-xl font-bold">{children}</h1>
  ),
  h2: ({ children }: MdProps) => (
    <h2 className="mt-4 mb-3 text-lg font-semibold">{children}</h2>
  ),
  h3: ({ children }: MdProps) => (
    <h3 className="mt-3 mb-2 text-base font-medium">{children}</h3>
  ),
  p: ({ children }: MdProps) => (
    <p className="mb-2 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: MdProps) => (
    <ul className="mb-3 list-inside list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }: MdProps) => (
    <ol className="mb-3 list-inside list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }: MdProps) => <li className="ml-4">{children}</li>,
  code: ({ children }: MdProps) => (
    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  ),
  pre: ({ children }: MdProps) => (
    <pre className="bg-muted mb-3 overflow-x-auto rounded-md p-3">
      {children}
    </pre>
  ),
  a: ({ href, children }: { href?: string } & MdProps) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:text-primary/80 underline"
    >
      {children}
    </a>
  ),
  strong: ({ children }: MdProps) => (
    <strong className="font-semibold">{children}</strong>
  ),
  blockquote: ({ children }: MdProps) => (
    <blockquote className="border-muted-foreground/20 my-3 border-l-4 pl-4 italic">
      {children}
    </blockquote>
  ),
}

/**
 * Settings section that displays a button which opens a dialog
 * showing the full release notes for the repository.
 *
 * Release notes are fetched once from GitHub on first open and
 * cached in component state for subsequent views.
 *
 * @example
 * ```tsx
 * <ReleaseNotesSection />
 * ```
 */
export function ReleaseNotesSection() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Opens the release notes dialog. Fetches notes from GitHub
   * on first invocation; uses the cached value on subsequent
   * opens. Sets an error message if the fetch fails.
   */
  const handleOpen = useCallback(async () => {
    if (notes !== null) {
      setOpen(true)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await fetchAllReleaseNotes(REPO_OWNER, REPO_NAME)
      setNotes(result)
      setOpen(true)
    } catch (e) {
      logger.error('Failed to fetch release notes', e)
      setError(t('settings.release_notes.error'))
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }, [notes, t])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleOpen}
        disabled={loading}
        aria-label={t('settings.release_notes.button_aria')}
      >
        <FileText className="mr-2 size-4" />
        {loading
          ? t('settings.release_notes.loading')
          : t('settings.release_notes.button')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] w-[800px] max-w-none flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('settings.release_notes.title')}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto p-4">
            {error ? (
              <p className="text-destructive text-sm">{error}</p>
            ) : (
              <div className="markdown-body text-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {notes || ''}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
