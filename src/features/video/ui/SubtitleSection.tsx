import { LAN_ALL } from '@/features/video/lib/batchSettings'
import { Checkbox } from '@/shared/animate-ui/radix/checkbox'
import {
  RadioGroup,
  RadioGroupItem,
} from '@/shared/animate-ui/radix/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Label } from '@/shared/ui/label'
import { AlertTriangle } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { SubtitleConfig, SubtitleInfo } from '../types'

/** Badge indicating AI-generated subtitle. */
function AiBadge() {
  return (
    <span className="rounded bg-blue-100 px-1 text-[10px] text-blue-700 dark:bg-blue-900 dark:text-blue-300">
      AI
    </span>
  )
}

type SubtitleSectionProps = {
  subtitles: Pick<SubtitleInfo, 'lan' | 'lanDoc' | 'isAi'>[]
  config: SubtitleConfig
  disabled: boolean
  page: number
  onConfigChange: (config: SubtitleConfig) => void
}

/**
 * Subtitle selection section for a video part.
 *
 * Provides mode selection (off/soft/hard) and language selection
 * with checkbox (soft) or radio (hard) controls.
 */
export const SubtitleSection = memo(function SubtitleSection({
  subtitles,
  config,
  disabled,
  page,
  onConfigChange,
}: SubtitleSectionProps) {
  const { t } = useTranslation()

  const noSubtitles = subtitles.length === 0
  // A seeded soft/hard default has nothing to embed when the part has no
  // subtitle tracks — the effective mode is "off" for all display state.
  const effectiveMode = noSubtitles ? 'off' : config.mode

  const modeOptions = [
    { id: 'off', label: t('video.subtitle_off') },
    { id: 'soft', label: t('video.subtitle_soft') },
    { id: 'hard', label: t('video.subtitle_hard') },
  ]

  function handleModeChange(mode: 'off' | 'soft' | 'hard') {
    if (mode === 'off') {
      onConfigChange({ mode: 'off', selectedLans: [] })
    } else if (mode === 'soft') {
      onConfigChange({
        mode: 'soft',
        selectedLans: subtitles.map((s) => s.lan),
      })
    } else {
      onConfigChange({
        mode: 'hard',
        selectedLans: subtitles[0] ? [subtitles[0].lan] : [],
      })
    }
  }

  function handleSoftSubtitleToggle(lan: string, checked: boolean) {
    const newSelectedLans = checked
      ? [...config.selectedLans, lan]
      : config.selectedLans.filter((l) => l !== lan)
    onConfigChange({ ...config, selectedLans: newSelectedLans })
  }

  function handleHardSubtitleChange(lan: string) {
    onConfigChange({ ...config, selectedLans: [lan] })
  }

  return (
    <div className="space-y-3">
      <RadioGroup
        value={effectiveMode}
        onValueChange={(value) =>
          handleModeChange(value as 'off' | 'soft' | 'hard')
        }
      >
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {modeOptions.map(({ id, label }) => {
            const unavailable = noSubtitles && id !== 'off'
            const unselectable = disabled || unavailable
            const control = (
              <div
                key={id}
                className={cn(
                  'flex min-h-[22px] min-w-[60px] items-center space-x-2 whitespace-nowrap',
                  unselectable && 'text-muted-foreground/60',
                )}
              >
                <RadioGroupItem
                  disabled={unselectable}
                  value={id}
                  id={`sub-mode-${page}-${id}`}
                />
                <Label
                  htmlFor={`sub-mode-${page}-${id}`}
                  className={cn(
                    'cursor-pointer',
                    unselectable && 'cursor-not-allowed',
                  )}
                >
                  {label}
                </Label>
              </div>
            )
            if (!unavailable) return control
            // Why: disabled radios swallow hover events; the wrapped span keeps
            // the tooltip trigger hoverable (CLAUDE.md disabled-tooltip pattern).
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <span>{control}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  {t('video.subtitle_none_available')}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </RadioGroup>

      {effectiveMode === 'soft' && (
        <div className="space-y-2">
          <div className="text-muted-foreground text-xs">
            {t('video.subtitle_select_multiple')}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {subtitles.map((sub) => (
              <div
                key={sub.lan}
                className="flex min-h-[22px] items-center space-x-2"
              >
                <Checkbox
                  disabled={disabled}
                  checked={
                    config.selectedLans.includes(sub.lan) ||
                    config.selectedLans.includes(LAN_ALL)
                  }
                  onCheckedChange={(checked) =>
                    handleSoftSubtitleToggle(sub.lan, checked === true)
                  }
                />
                <Label className="flex items-center gap-1">
                  {sub.lanDoc}
                  {sub.isAi && <AiBadge />}
                </Label>
              </div>
            ))}
          </div>
        </div>
      )}

      {effectiveMode === 'hard' && (
        <div className="space-y-2">
          <RadioGroup
            value={config.selectedLans[0] || ''}
            onValueChange={handleHardSubtitleChange}
          >
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {subtitles.map((sub) => (
                <div
                  key={sub.lan}
                  className="flex min-h-[22px] items-center space-x-2"
                >
                  <RadioGroupItem
                    disabled={disabled}
                    value={sub.lan}
                    id={`sub-hard-${page}-${sub.lan}`}
                  />
                  <Label
                    htmlFor={`sub-hard-${page}-${sub.lan}`}
                    className="flex items-center gap-1"
                  >
                    {sub.lanDoc}
                    {sub.isAi && <AiBadge />}
                  </Label>
                </div>
              ))}
            </div>
          </RadioGroup>
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-amber-700 dark:text-amber-300">
              {t('video.subtitle_hard_warning')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
})
