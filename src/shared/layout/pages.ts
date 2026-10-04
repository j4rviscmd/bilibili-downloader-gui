/**
 * Every routable page path (sidebar order). Single source shared by the
 * persistent layout (valid navigation targets), the startup-page redirect
 * validation, and the Settings startup-page options.
 */
export const PAGE_PATHS = [
  '/video-search',
  '/search',
  '/downloads',
  '/history',
  '/favorite',
  '/watch-history',
  '/trim',
  '/concat',
  '/audio',
  '/resolution',
  '/rotation',
  '/gif',
  '/settings',
] as const
