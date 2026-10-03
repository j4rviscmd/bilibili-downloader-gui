import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { searchSuggestApi } from '../api/searchSuggest'

/** Debounce for the suggest fetch — fast enough to feel live, slow enough to
 * avoid a request per keystroke. */
const SUGGEST_DEBOUNCE_MS = 300

/**
 * Keyword input + submit button with live search suggestions.
 *
 * WAI-ARIA combobox: ↑/↓ move the active option, Enter picks it (Enter with
 * no active option submits the raw draft), Esc closes the dropdown. The
 * suggest fetch is debounced and best-effort — failures render nothing
 * instead of interrupting typing.
 */
export function VideoSearchInput({
  onSearch,
  loading,
}: {
  onSearch: (keyword: string) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  // Stale-response guard: only the latest debounce round may set state.
  const latestRound = useRef(0)
  const listId = useId()

  useEffect(() => {
    // Bump the round even for blank drafts: an in-flight response for a
    // previous draft must not re-open the list after the input clears.
    const round = ++latestRound.current
    const trimmed = draft.trim()
    if (!trimmed) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const timer = setTimeout(() => {
      void searchSuggestApi(trimmed)
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
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft])

  const submit = (keyword: string) => {
    setOpen(false)
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
      setDraft(suggestions[activeIndex] ?? draft)
      submit(suggestions[activeIndex] ?? draft)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const select = (value: string) => {
    setDraft(value)
    submit(value)
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
              onClick={() => select(value)}
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
