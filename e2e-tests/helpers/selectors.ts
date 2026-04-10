/**
 * Centralized CSS selectors for bilibili-downloader-gui E2E tests.
 *
 * Selectors are derived from actual DOM attributes in the codebase:
 * - data-slot attributes from shadcn/ui / Radix UI primitives
 * - data-part-list / data-part-index custom attributes
 * - aria-label attributes on navigation buttons
 * - Standard HTML attributes (input[name], [role="alert"])
 */

// -- Init Page --

/** Full-page centered container shown during app initialization. */
export const INIT_CONTAINER = '.flex.h-full.w-full.items-center.justify-center'

/** Spinning loader indicator on the initialization page. */
export const INIT_SPINNER = '.animate-spin.rounded-full'

/** Status text label shown below the spinner during initialization. */
export const INIT_STATUS_TEXT = '.text-muted-foreground.text-sm'

// -- Sidebar --

/** Root sidebar element rendered by shadcn/ui. */
export const SIDEBAR = '[data-slot="sidebar"]'

/** Sidebar navigation menu area (typically the header section). */
export const SIDEBAR_HEADER = '[data-slot="sidebar-menu"]'

/** Sidebar footer section containing settings and download history buttons. */
export const SIDEBAR_FOOTER = '[data-slot="sidebar-footer"]'

// Navigation buttons (aria-labels from i18n en.json)

/** Sidebar navigation button for the download (home) page. */
export const NAV_HOME = '[aria-label="Navigate to download page"]'

/** Sidebar navigation button for the favorites page. */
export const NAV_FAVORITE = '[aria-label="Navigate to favorites page"]'

/** Sidebar navigation button for the watch history page. */
export const NAV_WATCH_HISTORY = '[aria-label="Navigate to watch history"]'

/** Sidebar navigation button for the download history page. */
export const NAV_DOWNLOAD_HISTORY =
  '[aria-label="Navigate to download history"]'

/** Currently active sidebar menu button (has `data-active="true"`). */
export const ACTIVE_NAV_ITEM =
  '[data-slot="sidebar-menu-button"][data-active="true"]'

// -- Settings

/** Visible text label of the settings button (used for text-based matching). */
export const SETTINGS_BUTTON_TEXT = 'Settings'

/** Overlay backdrop element for shadcn/ui dialog components. */
export const DIALOG_OVERLAY = '[data-slot="dialog-overlay"]'

/** Content panel of a shadcn/ui dialog. */
export const DIALOG_CONTENT = '[data-slot="dialog-content"]'

/** Title element inside a shadcn/ui dialog. */
export const DIALOG_TITLE = '[data-slot="dialog-title"]'

// -- Home Page: Step 1 (URL Input) --

/** Text input field for entering a Bilibili video URL. */
export const URL_INPUT = 'input[name="url"]'

/** Title element of the first card on the home page (Step 1: URL input). */
export const STEP1_CARD_TITLE = '[data-slot="card-title"]'

// -- Home Page: Step 2 (Video Parts) --

/** Title element of the second card on the home page (Step 2: video parts). */
export const STEP2_CARD_TITLE = '[data-slot="card-title"]:nth-of-type(2)'

/** Container element that holds the list of downloadable video parts. */
export const DATA_PART_LIST = '[data-part-list]'

/**
 * Returns a CSS selector for a specific video part card by its zero-based index.
 *
 * @param index - Zero-based index of the video part (e.g. `0` for the first part)
 * @returns CSS selector string targeting the `[data-part-index]` attribute
 *
 * @example
 * ```typescript
 * const firstPart = await browser.$(DATA_PART_INDEX(0))
 * ```
 */
export const DATA_PART_INDEX = (index: number) => `[data-part-index="${index}"]`

// -- Home Page: Login Alert --

/** Alert banner prompting the user to log in for additional benefits. */
export const LOGIN_ALERT = '[data-slot="alert"][role="alert"]'

/** Title text inside the login benefits alert. */
export const LOGIN_ALERT_TITLE = '[data-slot="alert-title"]'

/** Description text inside the login benefits alert. */
export const LOGIN_ALERT_DESCRIPTION = '[data-slot="alert-description"]'

// -- Download Button --

/** Ripple-effect download button (enabled after video parts are loaded and selected). */
export const DOWNLOAD_BUTTON = '[data-slot="ripple-button"]'
