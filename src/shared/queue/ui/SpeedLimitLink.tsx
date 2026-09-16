import { useSelector } from '@/app/store'
import { IconButton } from '@/components/animate-ui/components/buttons/icon'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { Button } from '@/shared/ui/button'
import { Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

/**
 * Formats a KB/s value with adaptive units for the indicator link:
 * below 1000 stays KB/s, above scales to MB/s (decimal, matching the
 * "1000 kb/s = 1 mb/s" hint). Display only — the stored setting stays
 * KB/s. Up to one fraction digit (e.g. 1500 → "1.5"). Literal "KB/s"/
 * "MB/s" follows the app's existing speed display convention
 * (PartDownloadProgress), not per-locale unit names.
 */
export function formatKbps(kbps: number): string {
  if (kbps < 1000) {
    return `${kbps.toLocaleString()} KB/s`
  }
  const mbps = (kbps / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })
  return `${mbps} MB/s`
}

/**
 * Speed-limit indicator link (issue #421), placed left of the cancel-all
 * button in the download status bar.
 *
 * Always rendered: while unlimited it is an entry point to enable a cap;
 * while limited it shows the current value. Clicking deep-links into
 * Settings (`download` category, scrolled to the speed-limit row);
 * changes apply to running downloads live via the backend limiter cell.
 */
export function SpeedLimitLink() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const settings = useSelector((state) => state.settings)
  const enabled = settings.downloadSpeedLimitEnabled ?? false

  const openSettings = () =>
    navigate('/settings?category=download&anchor=speed-limit')

  // While unlimited there is no value to show — the longest localized
  // string in the bar for zero information. Icon-only with a tooltip
  // (verification decision); the limited state below keeps icon + value.
  if (!enabled) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={openSettings}
              aria-label={t('downloadStatus.speed_limit_set')}
              data-testid="speed-limit-link"
              className="text-muted-foreground hover:text-foreground"
            >
              <Gauge className="size-3.5" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="top" arrow>
            {t('downloadStatus.speed_limit_set')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Matches the adjacent rate display (muted, text-sm, size-3.5
              icon, tabular-nums): the former link variant rendered in
              primary color with a larger icon and read brighter/bigger
              than the rate next to it (verification feedback). */}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-7 px-1 text-sm tabular-nums"
            onClick={openSettings}
            aria-label={t('downloadStatus.speed_limit_tooltip')}
            data-testid="speed-limit-link"
          >
            <Gauge className="size-3.5" aria-hidden />
            {settings.downloadSpeedLimitKbps != null &&
              formatKbps(settings.downloadSpeedLimitKbps)}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {/* max-w-xs wraps the sentence (same pattern as the parallelism
              CDN warning tooltip in DownloadSection). */}
          <p className="max-w-xs">{t('downloadStatus.speed_limit_tooltip')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
