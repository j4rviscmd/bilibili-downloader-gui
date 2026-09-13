import { store } from '@/app/store'
import { openDirectoryDialog } from '@/features/settings/lib/directoryDialog'
import { validateOutputPath } from '@/features/settings/lib/pathValidation'
import {
  SPEED_LIMIT_MAX_KBPS,
  SPEED_LIMIT_MIN_KBPS,
  useSpeedLimitKbps,
} from '@/features/settings/lib/useSpeedLimitKbps'
import { SettingChoiceCards } from '@/features/settings/ui/SettingChoiceCards'
import { SettingField, SettingRow } from '@/features/settings/ui/SettingRow'
import { SettingToggleGroup } from '@/features/settings/ui/SettingToggleGroup'
import { TitleReplacementSettings } from '@/features/settings/ui/TitleReplacementSettings'
import { useSettings } from '@/features/settings/useSettings'
import { videoApi } from '@/features/video'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Separator } from '@/shared/ui/separator'
import { Switch } from '@/shared/ui/switch'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

// Constraint: values must stay in sync with the allowed steps in
// Settings::resolve_segment_concurrency (1/2/4/6/8). Adding or
// removing a value here requires updating the backend matcher
// (issue #491).
const PARALLELISM_VALUES = [1, 2, 4, 6, 8] as const

/** Codec card choices with i18n keys; translated at render time. */
const CODEC_CHOICES = [
  {
    value: 'av1First',
    labelKey: 'settings.video_codec_av1_first',
    tooltipKey: 'settings.video_codec_av1_first_description',
    hintKey: 'settings.video_codec_av1_first_chain',
  },
  {
    value: 'hevcFirst',
    labelKey: 'settings.video_codec_hevc_first',
    tooltipKey: 'settings.video_codec_hevc_first_description',
    hintKey: 'settings.video_codec_hevc_first_chain',
  },
  {
    value: 'avcOnly',
    labelKey: 'settings.video_codec_avc_only',
    tooltipKey: 'settings.video_codec_avc_only_description',
    hintKey: 'settings.video_codec_avc_only_chain',
  },
] as const

/**
 * Download category: where files land, how many segments download in
 * parallel, filename shaping rules, and the preferred video codec.
 */
export function DownloadSection() {
  const { t } = useTranslation()
  const { settings, saveByForm } = useSettings()
  const [isUpdatingDlOutputPath, setIsUpdatingDlOutputPath] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)
  const speedLimit = useSpeedLimitKbps()

  /** Handles download output path selection. */
  const handleDlOutputPathChange = async () => {
    setIsUpdatingDlOutputPath(true)
    try {
      const selected = await openDirectoryDialog(
        'settings.output_dir_dialog_title',
        settings.dlOutputPath,
      )
      if (selected) {
        const error = validateOutputPath(selected, t)
        setPathError(error)
        if (error === null) {
          await saveByForm({ dlOutputPath: selected })
        }
      }
    } finally {
      setIsUpdatingDlOutputPath(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingField label={t('settings.output_dir_label')}>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={settings.dlOutputPath}
            placeholder={t('settings.output_dir_placeholder')}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleDlOutputPathChange}
            disabled={isUpdatingDlOutputPath}
          >
            {t(
              isUpdatingDlOutputPath
                ? 'settings.output_dir_changing'
                : 'settings.output_dir_button',
            )}
          </Button>
        </div>
        {pathError !== null && (
          <p className="text-destructive text-sm">{pathError}</p>
        )}
        <p className="text-muted-foreground text-sm">
          {t('settings.output_dir_description')}
        </p>
      </SettingField>
      {/* Why: one separator per group boundary, not per item — issue #693 allows
          adjacent settings in the same group to go undivided */}
      <Separator />
      <SettingField
        label={
          <span className="flex items-center gap-2">
            {t('settings.download_parallelism_label')}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="text-muted-foreground h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    {t('settings.download_parallelism_cdn_warning')}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        }
      >
        <SettingToggleGroup
          value={String(settings.downloadParallelism ?? 8)}
          onValueChange={(value) => {
            saveByForm({ downloadParallelism: Number(value) })
          }}
          options={PARALLELISM_VALUES.map((value) => ({
            value: String(value),
            label: String(value),
          }))}
        />
      </SettingField>
      <Separator />
      <SettingRow
        label={t('settings.auto_rename_duplicates_label')}
        description={t('settings.auto_rename_duplicates_description')}
      >
        <Switch
          checked={settings.autoRenameDuplicates ?? true}
          onCheckedChange={(checked) => {
            saveByForm({ autoRenameDuplicates: checked })
            // Clear video cache so new setting applies on next fetch
            store.dispatch(videoApi.util.resetApiState())
          }}
        />
      </SettingRow>
      <SettingRow
        label={t('settings.omit_duplicate_part_title_label')}
        description={t('settings.omit_duplicate_part_title_description')}
      >
        {/* Constraint: the `?? true` default must stay in sync with the Rust
            default (`unwrap_or(true)` in fetch_video_info /
            fetch_bangumi_info); a divergence would make the toggle display a
            state the backend does not implement. */}
        <Switch
          checked={settings.omitDuplicatePartTitle ?? true}
          onCheckedChange={(checked) => {
            saveByForm({ omitDuplicatePartTitle: checked })
            // Clear video cache so new setting applies on next fetch
            store.dispatch(videoApi.util.resetApiState())
          }}
        />
      </SettingRow>
      <Separator />
      {/* id is the deep-link anchor for /settings?category=download&anchor=
          speed-limit (the download status bar's limit link, issue #421). */}
      <div id="setting-speed-limit">
        <SettingRow
          label={t('settings.download_speed_limit_label')}
          description={t('settings.download_speed_limit_description')}
        >
          {/* Constraint: `speedLimit.enabled` mirrors the backend default
              (resolve_download_speed_limit_bps treats a missing/off switch
              as unlimited); a divergence would make the toggle display a
              state the backend does not implement. */}
          <Switch
            checked={speedLimit.enabled}
            onCheckedChange={speedLimit.handleLimitToggle}
          />
        </SettingRow>
      </div>
      {speedLimit.enabled && (
        <SettingField
          label={t('settings.download_speed_limit_kbps_label')}
          description={t('settings.download_speed_limit_kbps_description')}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={SPEED_LIMIT_MIN_KBPS}
            max={SPEED_LIMIT_MAX_KBPS}
            step={100}
            className="w-40"
            value={speedLimit.kbpsDraft}
            // The hook's setKbpsDraft also clears a shown error.
            onChange={(e) => speedLimit.setKbpsDraft(e.target.value)}
            onBlur={speedLimit.commitKbps}
            onKeyDown={(e) => {
              if (e.key === 'Enter') speedLimit.commitKbps()
            }}
            data-testid="speed-limit-kbps-input"
          />
          {speedLimit.kbpsError !== null && (
            <p className="text-destructive text-sm">{speedLimit.kbpsError}</p>
          )}
        </SettingField>
      )}
      {/* The speed-limit pair (anchor row + conditional value field) stays
          together between the surrounding separators. */}
      <Separator />
      <TitleReplacementSettings />
      <Separator />
      <SettingField
        label={t('settings.video_codec_priority_label')}
        description={t('settings.video_codec_priority_description')}
      >
        <SettingChoiceCards
          value={settings.videoCodecPriority ?? 'av1First'}
          onValueChange={(value) => {
            saveByForm({
              videoCodecPriority: value as 'av1First' | 'hevcFirst' | 'avcOnly',
            })
          }}
          options={CODEC_CHOICES.map((choice) => ({
            value: choice.value,
            label: t(choice.labelKey),
            tooltip: t(choice.tooltipKey),
            hint: t(choice.hintKey),
          }))}
        />
      </SettingField>
    </div>
  )
}
