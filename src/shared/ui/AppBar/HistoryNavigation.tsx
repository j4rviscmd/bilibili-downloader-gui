import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { Button } from '@/shared/ui/button'
import type { LucideIcon } from 'lucide-react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

/**
 * Back/forward availability derived from the browser history stack.
 */
export interface HistoryAvailability {
  readonly back: boolean
  readonly forward: boolean
}

/**
 * Reports whether history back/forward navigation has an entry to go to.
 *
 * react-router (BrowserRouter) tracks the stack position in
 * `window.history.state.idx` (0 = initial entry), so `idx > 0` means a
 * back entry exists and `idx < length - 1` means a forward entry exists.
 * `idx` is absent on a fresh history state, which is treated as the
 * initial entry.
 *
 * Exported as a pure seam for unit testing: jsdom pins
 * `history.length` at 1, so the forward case cannot be exercised
 * through the component in tests.
 */
export function resolveHistoryAvailability(
  history: Pick<History, 'state' | 'length'>,
): HistoryAvailability {
  const idx = typeof history.state?.idx === 'number' ? history.state.idx : 0
  return {
    back: idx > 0,
    forward: idx < history.length - 1,
  }
}

interface HistoryNavButtonProps {
  readonly icon: LucideIcon
  readonly label: string
  /** Shown as a tooltip only while the button is disabled. */
  readonly disabledReason: string
  readonly enabled: boolean
  readonly onClick: () => void
}

/**
 * Single back/forward button styled like the sidebar trigger.
 *
 * When disabled, the button is wrapped in a span + tooltip explaining
 * why (project convention for disabled controls); when enabled the
 * button renders bare with its aria-label only.
 */
function HistoryNavButton({
  icon: Icon,
  label,
  disabledReason,
  enabled,
  onClick,
}: HistoryNavButtonProps) {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      disabled={!enabled}
      onClick={onClick}
      aria-label={label}
      className="h-full shrink-0 cursor-pointer"
    >
      <Icon />
      <span className="sr-only">{label}</span>
    </Button>
  )

  if (enabled) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Disabled buttons block hover (pointer-events: none), so the
            span wrapper receives it for the tooltip. */}
        <span className="flex h-full">{button}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{disabledReason}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Browser-style back/forward page navigation for the app bar (issue #692).
 *
 * Steps through the session history via `navigate(-1)` / `navigate(1)`;
 * only in-app page transitions use the stack (search pagination
 * navigates with `replace`), so the buttons walk page switches exactly.
 */
export function HistoryNavigation() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Re-render on every location change so the availability read below
  // tracks the history stack after each push/pop/replace.
  useLocation()

  const { back, forward } = resolveHistoryAvailability(window.history)

  return (
    <TooltipProvider>
      <div className="flex h-full items-stretch">
        <HistoryNavButton
          icon={ChevronLeft}
          label={t('nav.aria.goBack')}
          disabledReason={t('nav.noBackHistory')}
          enabled={back}
          onClick={() => navigate(-1)}
        />
        <HistoryNavButton
          icon={ChevronRight}
          label={t('nav.aria.goForward')}
          disabledReason={t('nav.noForwardHistory')}
          enabled={forward}
          onClick={() => navigate(1)}
        />
      </div>
    </TooltipProvider>
  )
}
