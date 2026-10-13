import type { ReactNode, Ref } from 'react'

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
  /**
   * Whole-page body scrolling (Qiita-style): the scroll container spans
   * the full inset width so the scrollbar rides the window edge and the
   * empty margins beside the centered rail also accept wheel scrolling.
   * The centered rail only sets a min-height floor, so children flow
   * naturally (no internal `overflow-y-auto` wrapper needed). `flex-1`
   * children still stretch to fill short pages (empty-state centering).
   */
  bodyScroll?: boolean
  /**
   * Receives the full-width scroll container element (`bodyScroll`
   * only). Pass a callback ref (e.g. a setState) when the element must
   * trigger re-renders (Virtuoso `customScrollParent`), or a plain ref
   * object for observer roots (useFeedSentinel).
   */
  scrollRef?: Ref<HTMLDivElement>
}

/**
 * Standardized per-page content frame for sub-pages.
 *
 * Unifies the layout skeleton shared by sub-pages: a centered
 * (max-w-[104rem] = 10xl-equivalent; Tailwind container presets stop at
 * 7xl) flex column with a header strip. Chrome (Sidebar / AppBar) is
 * provided separately by PageLayoutShell; this template owns only the
 * per-page frame rendered as the content inside it.
 *
 * Layout rules:
 * - Header renders a simple title (+ optional description) when no `actions`,
 *   or a responsive toolbar row (title / actions) when `actions` is provided.
 * - `children` are rendered inside a body wrapper that shares the header's
 *   horizontal padding (`px-4 sm:px-6`), so titles and content align. Two
 *   body modes:
 *   1. `bodyScroll` (whole-page scroll): the template renders a full-width
 *      `overflow-y-auto` container holding the centered rail, so the
 *      scrollbar rides the window edge (Qiita-style) and the empty margins
 *      beside the rail also scroll. Children are plain flow content with
 *      their own vertical padding.
 *   2. default (internal scroll regions): a `flex min-h-0 flex-1 flex-col`
 *      body wrapper whose children use `flex-1 min-h-0 overflow-y-auto` for
 *      the scrollable area and `shrink-0` for pinned sections/actions, so
 *      action buttons stay visible regardless of content length (concat).
 *
 * The root is `h-full` to stay compatible with PersistentPageLayout's
 * `display:none` persistence strategy (keeps the template mounted but hidden).
 *
 * @example
 * ```tsx
 * // Simple form page, whole-page scroll (trim / audio / downloads)
 * <PageTemplate
 *   title={t('trim.title')}
 *   description={t('trim.description')}
 *   bodyScroll
 * >
 *   <div className="pt-2 pb-4 sm:pt-3 sm:pb-6">
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
  bodyScroll = false,
  scrollRef,
}: PageTemplateProps) {
  const hasActions = actions !== undefined

  const headerNode = hasActions ? (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-xl font-semibold">{title}</h1>
      {actions}
    </div>
  ) : (
    <div>
      <h1 className="text-xl font-semibold">{title}</h1>
      {description !== undefined && (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      )}
    </div>
  )

  if (bodyScroll) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* Why relative: same positioning context as the internal-mode
            header — absolutely-positioned actions (popular's row-centered
            search box) anchor to the centered rail, not the full-width
            scroll container. */}
        <div className="border-border relative mx-auto w-full max-w-[104rem] shrink-0 border-b px-4 py-3 sm:px-6">
          {headerNode}
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <div className="mx-auto flex min-h-full w-full max-w-[104rem] flex-col px-4 sm:px-6">
            {children}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[104rem] flex-col overflow-hidden">
      {/* Why relative: positioning context for absolutely-positioned
          actions (e.g. the row-centered search box on
          popular/video-search). */}
      <div className="border-border relative shrink-0 border-b px-4 py-3 sm:px-6">
        {headerNode}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 sm:px-6">
        {children}
      </div>
    </div>
  )
}
