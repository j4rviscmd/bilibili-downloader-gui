import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Search, X } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchHistoryEntry } from '../api/searchHistory'
import {
  clearSearchHistoryApi,
  getSearchHistoryApi,
  recordSearchApi,
  removeSearchHistoryApi,
} from '../api/searchHistory'
import { searchSuggestApi } from '../api/searchSuggest'
import type { TrendingKeyword } from '../api/searchTrending'
import { searchTrendingApi } from '../api/searchTrending'

/** Debounce for the suggest fetch — fast enough to feel live, slow enough to
 * avoid a request per keystroke. */
const SUGGEST_DEBOUNCE_MS = 300

/** Trending keywords change slowly; refetching on every focus would hammer
 * the WBI-signed endpoint for no visible benefit. */
const TRENDING_CACHE_MS = 5 * 60_000

/** One keyboard-navigable row of the dropdown, regardless of section. */
type DropdownItem =
  | { kind: 'history'; keyword: string }
  | { kind: 'trending'; keyword: string; label: string }
  | { kind: 'suggest'; keyword: string }

/**
 * Keyword input + submit button with live search suggestions.
 *
 * WAI-ARIA combobox: ↑/↓ move the active option, Enter picks it (Enter with
 * no active option submits the raw draft), Esc closes the dropdown, and
 * focusing the input re-suggests for the current value. Picking a suggestion
 * never re-suggests the committed keyword. The suggest fetch is debounced
 * and best-effort — failures render nothing instead of interrupting typing.
 *
 * With a blank draft the dropdown instead shows the bilibili-style panels:
 * local search history (newest first, with per-item and clear-all delete)
 * plus trending keywords. Both sections form one flat list for keyboard
 * navigation; Delete removes the active history row.
 */
export function VideoSearchInput({
  onSearch,
  loading,
  keyword,
}: {
  onSearch: (keyword: string) => void
  loading: boolean
  /** External keyword source (the results page's ?q=): keeps the input in
   * sync when navigation (back/forward) changes it outside this input. */
  keyword?: string
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [history, setHistory] = useState<SearchHistoryEntry[]>([])
  const [trending, setTrending] = useState<TrendingKeyword[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  // Stale-response guard: only the latest debounce round may set state.
  const latestRound = useRef(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  // Set when a suggestion pick is about to overwrite the draft: the effect
  // must skip its suggest fetch for that programmatic change (the search
  // already ran on the picked value).
  const suppressNextSuggest = useRef(false)
  // Pending suggest debounce timer; submit clears it so a search fired
  // mid-debounce never spawns a stale fetch that reopens the list over
  // the results page.
  const suggestTimer = useRef<number | undefined>(undefined)
  const trendingCache = useRef<{ at: number; data: TrendingKeyword[] } | null>(
    null,
  )

  const hasDraft = draft.trim().length > 0

  // The dropdown renders one flat list: suggestions while typing, otherwise
  // history + trending. Keeping it flat preserves the modulo keyboard nav.
  const items = useMemo<DropdownItem[]>(() => {
    if (hasDraft) {
      return suggestions.map((keyword) => ({
        kind: 'suggest' as const,
        keyword,
      }))
    }
    return [
      ...history.map(({ keyword }) => ({ kind: 'history' as const, keyword })),
      ...trending.map(({ keyword, showName }) => ({
        kind: 'trending' as const,
        keyword,
        label: showName,
      })),
    ]
  }, [hasDraft, suggestions, history, trending])

  const dropdownOpen = open && items.length > 0

  // Fetch suggestions for a keyword and open the list on success. Bumping
  // the round invalidates every earlier in-flight response.
  const requestSuggest = useCallback((keyword: string) => {
    const round = ++latestRound.current
    void searchSuggestApi(keyword)
      .then((values) => {
        if (round !== latestRound.current) return
        setSuggestions(values)
        setActiveIndex(-1)
        setOpen(values.length > 0)
      })
      .catch(() => {
        // Best-effort: never surface suggest errors mid-typing.
        if (round === latestRound.current) setOpen(false)
      })
  }, [])

  // Loads the blank-input panels: local history (cheap, always fresh) and
  // trending (cached). Shares latestRound with requestSuggest so a later
  // keystroke invalidates an in-flight panel load, and vice versa.
  const loadPanels = useCallback(() => {
    const round = ++latestRound.current
    setOpen(true)
    void getSearchHistoryApi()
      .then((entries) => {
        if (round === latestRound.current) setHistory(entries)
      })
      .catch(() => {})
    const cached = trendingCache.current
    if (cached && Date.now() - cached.at < TRENDING_CACHE_MS) {
      setTrending(cached.data)
      return
    }
    void searchTrendingApi()
      .then((keywords) => {
        if (round !== latestRound.current) return
        trendingCache.current = { at: Date.now(), data: keywords }
        setTrending(keywords)
      })
      .catch(() => {})
  }, [])

  // Removes one history keyword; the command resolves to the updated list so
  // the panel refreshes in a single round trip. Best-effort like every
  // suggest-path call.
  const removeHistoryItem = useCallback((keyword: string) => {
    // Why bump: the focus-time history fetch may still be in flight; its
    // stale response would otherwise resurrect the removed row (it shares
    // the round guard with loadPanels).
    latestRound.current++
    void removeSearchHistoryApi(keyword)
      .then((entries) => {
        setHistory(entries)
        // The list shrank: clear the active row so aria-activedescendant
        // never points at an option id that no longer exists.
        setActiveIndex(-1)
      })
      .catch(() => {})
  }, [])

  // Draft as of the previous effect run; only a real draft change may bump
  // the stale-response round below.
  const prevDraft = useRef(draft)

  useEffect(() => {
    const draftChanged = prevDraft.current !== draft
    prevDraft.current = draft
    // Bump the round even for blank/suppressed drafts: an in-flight response
    // for a previous draft must not re-open the list afterwards.
    // Why gated on draftChanged: history/trending in the deps re-run this
    // effect whenever a panel load settles — an unconditional bump there
    // invalidates the sibling in-flight panel fetch (loadPanels), silently
    // dropping whichever panel response lands second (the network-bound
    // trending fetch always loses to the local history read).
    if (draftChanged) latestRound.current++
    if (suppressNextSuggest.current) {
      suppressNextSuggest.current = false
      return
    }
    if (!hasDraft) {
      setSuggestions([])
      setActiveIndex(-1)
      // Deleting the text mid-focus falls back to the panels (bilibili-like:
      // blank draft = history + trending). The panels may never have loaded:
      // an input focused WITH a keyword (the results page) takes the
      // suggest path in handleFocus, so fetch them now instead of staying
      // closed. Why guarded on draftChanged: history/trending in the deps
      // re-run this effect whenever a panel load settles — without the
      // guard each settle would refetch via loadPanels in a loop. Why the
      // focus check: a programmatic draft clear (keyword sync on a hidden
      // page) must not fetch or open anything.
      if (draftChanged && document.activeElement === inputRef.current) {
        loadPanels()
      } else {
        // Not a user-driven blanking: either a panel load just settled
        // (recompute open — opens now that data arrived) or focus is
        // elsewhere / panels still empty (stay closed).
        setOpen(history.length > 0 || trending.length > 0)
      }
      return
    }
    // Why: window. selects the DOM overload so the timer id stays number for
    // the number-typed ref — bare setTimeout returns NodeJS.Timeout under the
    // installed @types/node (same pattern as VideoPreviewDialog.tsx saveTimer).
    suggestTimer.current = window.setTimeout(
      () => requestSuggest(draft.trim()),
      SUGGEST_DEBOUNCE_MS,
    )
    return () => clearTimeout(suggestTimer.current)
    // history/trending are read only for the blank branch's open decision;
    // listing them re-runs the effect when panel loads settle, which merely
    // recomputes that decision. loadPanels is a stable callback ([] deps).
  }, [draft, hasDraft, history, trending, requestSuggest, loadPanels])

  // External keyword sync (back/forward changes ?q= outside this input):
  // adopt it into the draft. URL navigation wins over any unsubmitted
  // local edit — the address bar is the source of truth for the results.
  // Adopting must not open the suggest dropdown (the search already ran on
  // this keyword) — the suggestion-pick suppression is reused. A
  // same-value adoption is skipped so the armed flag cannot eat the next
  // real keystroke's suggest round (React bails out on setDraft then).
  useEffect(() => {
    if (keyword === undefined) return
    if (inputRef.current?.value === keyword) return
    suppressNextSuggest.current = true
    setDraft(keyword)
  }, [keyword])

  const submit = (keyword: string) => {
    // Why: Enter can beat both the debounce timer and the suggest fetch it
    // spawned — clear the pending timer and invalidate in-flight responses,
    // or their setOpen(true) reopens the list over the results page.
    clearTimeout(suggestTimer.current)
    latestRound.current++
    setOpen(false)
    // Hand focus back to the page once the search fires, so the closed
    // dropdown stays closed and results get keyboard focus (YouTube-like).
    inputRef.current?.blur()
    // Record the keyword locally (bilibili-style search history); the panel
    // refetches on the next blank focus, so no local echo is needed.
    void recordSearchApi(keyword).catch(() => {})
    onSearch(keyword)
  }

  /**
   * Keyboard controller for the suggestion listbox. With the list closed
   * (or nothing active) every key falls through so Enter submits the form
   * with the raw draft.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Why: WKWebView (Safari engine) reports real keys with
    // isComposing=true during CJK conversion — Enter/arrows must steer the
    // IME candidate window, not this listbox, and Enter-to-commit must not
    // pick the active suggestion.
    if (e.nativeEvent.isComposing) return
    if (!dropdownOpen) return
    const active = activeIndex >= 0 ? items[activeIndex] : undefined
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active) {
      e.preventDefault()
      commitPick(active.keyword)
    } else if (
      (e.key === 'Delete' || (e.key === 'Backspace' && draft.length === 0)) &&
      active?.kind === 'history'
    ) {
      // Keyboard path for the per-row delete (the × affordance is
      // mouse-only); history is the only deletable section. Backspace is
      // included for Apple laptops whose 'delete' key reports 'Backspace' —
      // gated on an empty draft, where Backspace has no text to erase.
      e.preventDefault()
      removeHistoryItem(active.keyword)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Fill the input with a picked suggestion and search it. A same-value pick
  // triggers React's state bailout (effect never runs), so the suppress flag
  // is armed only when the draft will actually change.
  const commitPick = (value: string) => {
    if (value !== draft) suppressNextSuggest.current = true
    setDraft(value)
    submit(value)
  }

  /**
   * Focusing the input re-suggests for the current value so the list is
   * available right where the user left it (YouTube-like). A blank input
   * opens the history + trending panels instead (bilibili-like).
   */
  const handleFocus = () => {
    if (hasDraft) {
      // Why: skips SUGGEST_DEBOUNCE_MS on purpose — that debounce exists to
      // batch keystrokes, while focus carries one final value; the focus
      // test asserts the fetch fires with a 0ms timer advance
      // (VideoSearchInput.test.tsx).
      requestSuggest(draft.trim())
    } else {
      loadPanels()
    }
  }

  return (
    <div className="relative w-full" onBlur={() => setOpen(false)}>
      <form
        className="flex w-full gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
      >
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={t('videoSearch.placeholder')}
          aria-label={t('videoSearch.placeholder')}
          role="combobox"
          aria-expanded={dropdownOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
          }
          autoComplete="off"
        />
        <Button type="submit" disabled={loading || !draft.trim()}>
          <Search />
          {t('videoSearch.searchButton')}
        </Button>
      </form>
      {dropdownOpen && (
        // Why z-50 (not z-10): the video card grid renders later in the
        // DOM with its own z-10 overlays (hover-play button); an equal
        // z-index tie resolves by DOM order, letting that overlay paint
        // — and hit-test — ABOVE this dropdown.
        <ul
          id={listId}
          role="listbox"
          aria-label={
            hasDraft
              ? t('videoSearch.suggestions')
              : t('videoSearch.searchHistory')
          }
          className="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border shadow-md"
        >
          {items.map((item, i) => {
            const prevKind = items[i - 1]?.kind
            return (
              // Why: the same keyword can sit in both history and trending
              // (independent sources); a keyword-only key would collide.
              <Fragment key={`${item.kind}:${item.keyword}`}>
                {item.kind === 'history' && prevKind !== 'history' && (
                  <li
                    role="presentation"
                    className="text-muted-foreground flex items-center justify-between px-3 pt-2 pb-1 text-xs font-medium"
                  >
                    <span>{t('videoSearch.searchHistory')}</span>
                    {/* Why preventDefault on mousedown: keeps focus on the
                     input so the wrapper's onBlur never closes the dropdown
                     before the click. */}
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        // Why bump: same stale-fetch guard as a single-row
                        // remove (see removeHistoryItem).
                        latestRound.current++
                        void clearSearchHistoryApi()
                          .then(() => {
                            setHistory([])
                            setActiveIndex(-1)
                          })
                          .catch(() => {})
                      }}
                      className="hover:text-foreground cursor-pointer"
                    >
                      {t('videoSearch.clearHistory')}
                    </button>
                  </li>
                )}
                {item.kind === 'trending' && prevKind !== 'trending' && (
                  <li
                    role="presentation"
                    className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium"
                  >
                    {t('videoSearch.trending')}
                  </li>
                )}
                <li
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  // Why: preventDefault on mousedown keeps focus on the input so
                  // the wrapper's onBlur never closes the list before the click.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitPick(item.keyword)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'cursor-pointer px-3 py-1.5 text-sm',
                    i === activeIndex && 'bg-accent',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {item.kind === 'trending' ? item.label : item.keyword}
                    </span>
                    {item.kind === 'history' && (
                      // Mouse-only affordance (aria-hidden keeps the
                      // redundant control out of the a11y tree); the keyboard
                      // path is Delete on the active option (handleKeyDown).
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeHistoryItem(item.keyword)
                        }}
                      >
                        <X className="size-3.5" />
                      </span>
                    )}
                  </span>
                </li>
              </Fragment>
            )
          })}
        </ul>
      )}
    </div>
  )
}
