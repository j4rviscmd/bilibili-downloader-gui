import { useSelector } from '@/app/store'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { Button } from '@/shared/ui/button'
import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { clampConcurrency } from '../runner'

/**
 * Concurrent-part-downloads indicator link, mirroring SpeedLimitLink
 * (issue #421): shows the live slot count (unlike the speed limit there
 * is no "unlimited" state, so a single branch suffices) and deep-links
 * into Settings (`download` category, scrolled to the concurrency
 * toggle). Rendered only while downloads are active.
 */
export function ConcurrencyLink() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const settings = useSelector((state) => state.settings)
  const cap = clampConcurrency(settings.maxConcurrentDownloads)

  const openSettings = () =>
    navigate('/settings?category=download&anchor=max-concurrent-downloads')

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Styling matches the adjacent SpeedLimitLink (ghost, muted)
              so the two links read as one cluster. */}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground relative h-7 px-1"
            onClick={openSettings}
            aria-label={`${t('downloadStatus.concurrent_downloads_tooltip')} ×${cap}`}
            data-testid="concurrency-link"
          >
            <Layers className="size-3.5" aria-hidden />
            {/* Counter-badge idiom (dock/notification badges): the slot
                count rides the icon's corner, so the button keeps a
                constant icon-only width in EVERY bottom-bar tier — the
                badge IS the value display, no text tier to degrade. */}
            <span
              data-testid="concurrency-badge"
              className="bg-primary text-primary-foreground absolute -top-1 -right-0.5 flex size-3.5 items-center justify-center rounded-full text-[9px] leading-none font-bold"
            >
              {cap}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="max-w-xs">
            {t('downloadStatus.concurrent_downloads_tooltip')}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
