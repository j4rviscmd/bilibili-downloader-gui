import type { ReactNode } from 'react'

/**
 * Props for PageTemplate component.
 */
export interface PageTemplateProps {
  /** Page title rendered in the header <h1>. */
  title: ReactNode
  /** Optional description shown below the title (simple layout only). */
  description?: ReactNode
  /** Optional header actions slot. Enables the toolbar header layout. */
  actions?: ReactNode
  /** Page content rendered after the header (typically the body wrapper). */
  children: ReactNode
}

/**
 * Standardized per-page content frame for sub-pages.
 *
 * Unifies the layout skeleton shared by sub-pages: a centered
 * (max-w-5xl) flex column with a header strip. Chrome (Sidebar / AppBar)
 * is provided separately by PageLayoutShell; this template owns only the
 * per-page frame rendered as the content inside it.
 *
 * Layout rules:
 * - Header renders a simple title (+ optional description) when no `actions`,
 *   or a responsive toolbar row (title / actions) when `actions` is provided.
 * - `children` are rendered inside a body wrapper that shares the header's
 *   horizontal padding (`px-4 sm:px-6`), so titles and content align. Each
 *   page controls its body height/scroll via children. Two idioms:
 *   1. Whole-body scroll — a single `min-h-0 flex-1 overflow-y-auto` child
 *      scrolls the entire body (trim / audio / resolution).
 *   2. Internal scroll regions — a `flex min-h-0 flex-1 flex-col` child
 *      whose inner sections use `flex-1 min-h-0 overflow-y-auto` for the
 *      scrollable area and `shrink-0` for pinned sections/actions, so action
 *      buttons stay visible regardless of content length (concat).
 *
 * The root is `h-full` to stay compatible with PersistentPageLayout's
 * `display:none` persistence strategy (keeps the template mounted but hidden).
 *
 * @example
 * ```tsx
 * // Simple form page (trim / concat)
 * <PageTemplate title={t('trim.title')} description={t('trim.description')}>
 *   <div className="min-h-0 flex-1 overflow-y-auto pt-2 pb-4 sm:pt-3 sm:pb-6">
 *     <TrimForm />
 *   </div>
 * </PageTemplate>
 *
 * // List page with toolbar actions (favorite / history / watch-history)
 * <PageTemplate title={t('favorite.title')} actions={<ToolbarActions />}>
 *   <div className="min-h-0 flex-1">
 *     <FavoriteList />
 *   </div>
 * </PageTemplate>
 * ```
 */
export function PageTemplate({
  title,
  description,
  actions,
  children,
}: PageTemplateProps) {
  const hasActions = actions !== undefined

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden">
      <div className="border-border shrink-0 border-b px-4 py-3 sm:px-6">
        {hasActions ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-xl font-semibold">{title}</h1>
            {actions}
          </div>
        ) : (
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {description !== undefined && (
              <p className="text-muted-foreground mt-1 text-sm">
                {description}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-6">
        {children}
      </div>
    </div>
  )
}
