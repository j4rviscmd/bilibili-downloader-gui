import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { searchSuggestApi } from '../api/searchSuggest'

/** Debounce for the suggest fetch — fast enough to feel live, slow enough to
 * avoid a request per keystroke. */
const SUGGEST_DEBOUNCE_MS = 300

/**
 * Keyword input + submit button with live search suggestions.
 *
 * WAI-ARIA combobox: ↑/↓ move the active option, Enter picks it (Enter with
 * no active option submits the raw draft), Esc closes the dropdown, and
 * focusing the input re-suggests for the current value. Picking a suggestion
 * never re-suggests the committed keyword. The suggest fetch is debounced
 * and best-effort — failures render nothing instead of interrupting typing.
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

  useEffect(() => {
    // Bump the round even for blank/suppressed drafts: an in-flight response
    // for a previous draft must not re-open the list afterwards.
    latestRound.current++
    if (suppressNextSuggest.current) {
      suppressNextSuggest.current = false
      return
    }
    const trimmed = draft.trim()
    if (!trimmed) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const timer = setTimeout(() => requestSuggest(trimmed), SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, requestSuggest])

  // External keyword sync (back/forward changes ?q= outside this input):
  // adopt it into the draft. URL navigation wins over any unsubmitted
  // local edit — the address bar is the source of truth for the results.
  useEffect(() => {
    if (keyword !== undefined) setDraft(keyword)
  }, [keyword])

  const submit = (keyword: string) => {
    setOpen(false)
    // Hand focus back to the page once the search fires, so the closed
    // dropdown stays closed and results get keyboard focus (YouTube-like).
    inputRef.current?.blur()
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
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      commitPick(suggestions[activeIndex] ?? draft)
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
   * has nothing to suggest.
   */
  const handleFocus = () => {
    const trimmed = draft.trim()
    // Why: skips SUGGEST_DEBOUNCE_MS on purpose — that debounce exists to
    // batch keystrokes, while focus carries one final value; the focus test
    // asserts the fetch fires with a 0ms timer advance (VideoSearchInput.test.tsx).
    if (trimmed) requestSuggest(trimmed)
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
          aria-expanded={open}
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
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('videoSearch.suggestions')}
          className="bg-popover text-popover-foreground absolute top-full left-0 z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border shadow-md"
        >
          {suggestions.map((value, i) => (
            <li
              key={value}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              // Why: preventDefault on mousedown keeps focus on the input so
              // the wrapper's onBlur never closes the list before the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commitPick(value)}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'cursor-pointer px-3 py-1.5 text-sm',
                i === activeIndex && 'bg-accent',
              )}
            >
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
