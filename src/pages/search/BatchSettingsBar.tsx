import type { RootState } from '@/app/store'
import { useAppDispatch, useSelector } from '@/app/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { openDirectoryDialog } from '@/features/settings/lib/directoryDialog'
import { useSettings } from '@/features/settings/useSettings'
import { useVideoInfo } from '@/features/video'
import {} from '@/features/video/api/fetchVideoInfo'
import {
  ANON_MAX_VIDEO_ID,
  AUDIO_LADDER_IDS,
  LAN_ALL,
  LOGIN_REQUIRED_VIDEO_IDS,
  SUBTITLE_LANGUAGES,
  VIDEO_LADDER_IDS,
  VIP_AUDIO_IDS,
  VIP_VIDEO_IDS,
} from '@/features/video/lib/batchSettings'
import {
  AUDIO_QUALITIES_MAP,
  VIDEO_QUALITIES_MAP,
} from '@/features/video/lib/constants'
import {
  deselectPageAll,
  selectPageAll,
  setBatchSettings,
  setOutputDirOverride,
} from '@/features/video/model/inputSlice'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { ChevronDown, FolderOpen, Info, SlidersVertical } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Batch settings bar: quality / audio / subtitle targets applied to every
 * selected part at once.
 *
 * Data honesty rules (see the design spec):
 * - Options are the UNION of the selected parts' fetched availability —
 *   the batch UI cannot know per-part causes, so it only offers what at
 *   least one selected part can use. Part-dependent gaps surface later as
 *   the existing download-time fallback + ⚠.
 * - The only static annotation is the login band (1080p+/1080p60) shown
 *   as disabled with a reason while logged out. VIP gating is NOT
 *   annotated: the app has no vip status, so VIP tiers simply appear in
 *   the union only when the account can actually fetch them.
 * - Changing a value overwrites the selected parts' partInputs
 *   (individual overrides lose to an explicit batch change, per spec).
 */
export function BatchSettingsBar() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { input } = useVideoInfo()
  const isLoggedIn = useSelector((state: RootState) => state.user.data.isLogin)

  const selectedIndices = useMemo(
    () =>
      input.partInputs
        .map((pi, i) => (pi.selected ? i : -1))
        .filter((i) => i >= 0),
    [input.partInputs],
  )

  // No eager per-part fetching: under the enqueue-resolution model the
  // batch targets derive from the static login-state ladder, unfetched
  // parts resolve best-effort in the backend, and subtitle tracks are
  // refetched there when the frontend passes none. Parts fetch lazily
  // when their own panel opens.

  // An explicit dropdown pick stores an override in state AND dispatches
  // to every selected part; merely changing the selection never dispatches.
  // Login-state best-effort defaults. Per-part ladders must NOT drive the
  // trigger: the eager fetch samples only a few parts, and select-all can
  // span hundreds (a per-part fetch of all of them would trip rate limits).
  // The static ladder + gates answer "best tier this login state can use";
  // the download itself falls back per part to the nearest available tier.
  // Enhanced tiers (1080p+/1080p60) and VIP tiers are explicit picks, not
  // defaults: many videos lack them, and a default pointing at a tier the
  // option list marks 利用不可 reads as a contradiction.
  const bestVideoForLogin = useMemo(
    () =>
      VIDEO_LADDER_IDS.find(
        (id) =>
          !VIP_VIDEO_IDS.has(id) &&
          !LOGIN_REQUIRED_VIDEO_IDS.has(id) &&
          (isLoggedIn || id <= ANON_MAX_VIDEO_ID),
      ) ?? null,
    [isLoggedIn],
  )
  const bestAudioForLogin = useMemo(
    () => AUDIO_LADDER_IDS.find((id) => !VIP_AUDIO_IDS.has(id)) ?? null,
    [],
  )

  // Batch targets live in redux and are applied at ENQUEUE time to parts
  // without an explicit per-part choice (resolution: explicit per-part >
  // batch > part default). Changing them never writes to parts — which is
  // why the triggers stay enabled with zero parts selected.
  const batch = useSelector((state: RootState) => state.input.batchSettings)
  const targetVideo = batch.videoQuality
    ? Number(batch.videoQuality)
    : bestVideoForLogin
  const targetAudio = batch.audioQuality
    ? Number(batch.audioQuality)
    : bestAudioForLogin
  const applyVideo = useCallback(
    (id: number) => dispatch(setBatchSettings({ videoQuality: String(id) })),
    [dispatch],
  )
  const applyAudio = useCallback(
    (id: number) => dispatch(setBatchSettings({ audioQuality: String(id) })),
    [dispatch],
  )
  const applySubtitle = useCallback(
    (mode: 'off' | 'soft' | 'hard', langs: string[]) =>
      dispatch(setBatchSettings({ subtitle: { mode, selectedLans: langs } })),
    [dispatch],
  )

  const { settings } = useSettings()
  const outputDirOverride = useSelector(
    (state: RootState) => state.input.outputDirOverride,
  )
  const outputDirLabel = outputDirOverride ?? settings.dlOutputPath ?? ''
  const pickOutputDir = useCallback(async () => {
    const dir = await openDirectoryDialog(
      'search.output_dir_picker',
      outputDirOverride ?? settings.dlOutputPath,
    )
    if (dir) dispatch(setOutputDirOverride(dir))
  }, [dispatch, outputDirOverride, settings.dlOutputPath])

  const label = (id: number) =>
    VIDEO_QUALITIES_MAP[id] ?? AUDIO_QUALITIES_MAP[id] ?? String(id)

  // Subtitle display mirrors the batch target; before any batch pick it
  // shows "off" (parts still default to their own configs at enqueue).
  const displaySubMode = batch.subtitle?.mode ?? 'off'
  const displaySubLangs = batch.subtitle?.selectedLans ?? []
  const modeLabel = t(
    displaySubMode === 'soft'
      ? 'video.subtitle_soft'
      : displaySubMode === 'hard'
        ? 'video.subtitle_hard'
        : 'video.subtitle_off',
  )
  // Fixed-list labels keep the trigger consistent with the dropdown
  // even before subtitles are fetched (the lazy fetch hasn't landed yet).
  const langLabels = displaySubLangs.map((l) =>
    l === LAN_ALL
      ? t('search.subtitle_all_langs')
      : (SUBTITLE_LANGUAGES.find((s) => s.lan === l)?.label ?? l),
  )
  const subSummary =
    displaySubMode === 'off'
      ? modeLabel
      : `${modeLabel} ${langLabels.join(displaySubMode === 'soft' ? ' + ' : ' → ')}`

  const shownSub = subSummary

  return (
    <div className="bg-card/95 sticky top-14 z-15 mt-3 rounded-xl border shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <SlidersVertical className="text-brand size-3.5 shrink-0" aria-hidden />
        <span className="text-xs font-bold">{t('search.batch_title')}</span>
        <span className="text-muted-foreground text-[11px]">
          {t('search.batch_applies', { count: selectedIndices.length })}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Whole-video range, regardless of the visible page: the batch
              bar applies to every selected part, and paging through to
              select each page's parts first would defeat the point. The
              range-based reducer is reused with the full range. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              dispatch(
                selectPageAll({
                  startIndex: 0,
                  endIndex: input.partInputs.length - 1,
                }),
              )
            }
          >
            {t('video.select_all')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              dispatch(
                deselectPageAll({
                  startIndex: 0,
                  endIndex: input.partInputs.length - 1,
                }),
              )
            }
          >
            {t('video.deselect_all')}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('search.help_label')}
              >
                <Info className="size-4" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-85 text-xs leading-relaxed"
            >
              <p className="font-semibold">{t('search.help_quality_title')}</p>
              <p className="text-muted-foreground mb-2">
                {t('search.help_quality_body')}
              </p>
              <p className="font-semibold">{t('search.help_subtitle_title')}</p>
              <p className="text-muted-foreground mb-2">
                {t('search.help_subtitle_body')}
              </p>
              <p className="font-semibold">{t('search.help_override_title')}</p>
              <p className="text-muted-foreground mb-2">
                {t('search.help_override_body')}
              </p>
              <p className="font-semibold">{t('search.help_output_title')}</p>
              <p className="text-muted-foreground">
                {t('search.help_output_body')}
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2.5 border-t px-4 py-2.5">
        <BatchDropdown
          label={t('video.quality_label')}
          value={targetVideo != null ? label(targetVideo) : ''}
          options={VIDEO_LADDER_IDS.map((id) => {
            const isVip = VIP_VIDEO_IDS.has(id)
            const needsLogin = !isLoggedIn && LOGIN_REQUIRED_VIDEO_IDS.has(id)
            return {
              id,
              label: label(id),
              // Static gating only: the option list is a target picker and
              // the backend resolves each part best-effort, so per-video
              // availability no longer disables tiers.
              disabled: isVip || needsLogin,
              disabledReason: isVip
                ? t('search.reason_vip')
                : needsLogin
                  ? t('search.reason_login')
                  : undefined,
            }
          })}
          onSelect={(id) => applyVideo(id)}
        />
        <BatchDropdown
          label={t('video.audio_quality_label')}
          value={targetAudio != null ? label(targetAudio) : ''}
          options={AUDIO_LADDER_IDS.map((id) => {
            const isVip = VIP_AUDIO_IDS.has(id)
            return {
              id,
              label: label(id),
              disabled: isVip,
              disabledReason: isVip ? t('search.reason_vip') : undefined,
            }
          })}
          onSelect={(id) => applyAudio(id)}
        />
        {/* Compound subtitle menu: mode section + separator + language
            section. Language items keep the menu open (multi-select in
            one visit); mode changes update the language display
            immediately (✓ for soft, 優先度 N for hard). */}
        <div className="flex flex-col">
          <span className="text-muted-foreground mb-1 text-[11px] font-semibold">
            {t('video.subtitle')}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('video.subtitle')}
              className="bg-card hover:bg-muted data-[state=open]:border-brand-strong/40 inline-flex h-10 items-center justify-between gap-2 rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-50"
            >
              <span className="max-w-60 truncate">{shownSub || '—'}</span>
              <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-96 w-64 overflow-y-auto"
            >
              {(['off', 'soft', 'hard'] as const).map((mode) => (
                <DropdownMenuItem
                  key={mode}
                  onSelect={(e) => {
                    // Keep the menu open: switching the mode immediately
                    // re-renders the language section (✓ ↔ 優先度 N).
                    e.preventDefault()
                  }}
                  onClick={() => {
                    // Hard burns one language; the soft-sub wildcard is
                    // meaningless there, so switching modes drops it.
                    const langs =
                      mode === 'off'
                        ? []
                        : mode === 'hard' && displaySubLangs.includes(LAN_ALL)
                          ? displaySubLangs.filter((l) => l !== LAN_ALL)
                          : displaySubLangs
                    applySubtitle(mode, langs)
                  }}
                  className={cn(
                    'flex justify-between gap-4',
                    displaySubMode === mode &&
                      'text-brand-strong dark:text-brand font-bold',
                  )}
                >
                  <span>
                    {t(
                      mode === 'off'
                        ? 'video.subtitle_off'
                        : mode === 'soft'
                          ? 'video.subtitle_soft'
                          : 'video.subtitle_hard',
                    )}
                  </span>
                  {displaySubMode === mode && (
                    <span className="text-muted-foreground text-[10px] font-semibold">
                      ✓
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {/* All-languages sentinel: bilibili's AI set exceeds the
                  fixed list (ar/pt…), so "everything" can only be
                  expressed as a wildcard, not as an enumeration. Soft-sub
                  only: hard-sub burns exactly ONE language, and a wildcard
                  there would burn an unpredictable one per part. Picking a
                  specific language replaces it. */}
              {displaySubMode === 'soft' && (
                <DropdownMenuItem
                  key={LAN_ALL}
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => {
                    const newLangs = displaySubLangs.includes(LAN_ALL)
                      ? []
                      : [LAN_ALL]
                    applySubtitle('soft', newLangs)
                  }}
                  className={cn(
                    'flex justify-between gap-4',
                    displaySubLangs.includes(LAN_ALL) &&
                      'text-brand-strong dark:text-brand font-bold',
                  )}
                >
                  <span>{t('search.subtitle_all_langs')}</span>
                  {displaySubLangs.includes(LAN_ALL) && (
                    <span className="text-muted-foreground text-[10px] font-semibold">
                      ✓
                    </span>
                  )}
                </DropdownMenuItem>
              )}
              {SUBTITLE_LANGUAGES.map(({ lan, label }) => {
                const idx = displaySubLangs.indexOf(lan)
                const selected = idx >= 0
                return (
                  <DropdownMenuItem
                    key={lan}
                    onSelect={(e) => {
                      // Keep the menu open: language selection is
                      // multi-select in one visit.
                      e.preventDefault()
                    }}
                    onClick={() => {
                      const newLangs = selected
                        ? displaySubLangs.filter((l) => l !== lan)
                        : displaySubLangs.includes(LAN_ALL)
                          ? [lan]
                          : [...displaySubLangs, lan]
                      // While mode is "off", a language click only
                      // stores the pending selection (mockup behavior:
                      // pre-select then pick a mode) — off-with-languages
                      // is meaningless until a mode activates it.
                      if (displaySubMode === 'off') {
                        dispatch(
                          setBatchSettings({
                            subtitle: { mode: 'off', selectedLans: newLangs },
                          }),
                        )
                        return
                      }
                      applySubtitle(displaySubMode ?? 'soft', newLangs)
                    }}
                    className={cn(
                      'flex justify-between gap-4',
                      selected && 'text-brand-strong dark:text-brand font-bold',
                    )}
                  >
                    <span>{label}</span>
                    {selected && (
                      <span className="text-muted-foreground text-[10px] font-semibold">
                        {displaySubMode === 'soft'
                          ? '✓'
                          : t('search.subtitle_priority', {
                              count: idx + 1,
                            })}
                      </span>
                    )}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground mb-1 text-[11px] font-semibold">
            {t('search.output_dir_label')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void pickOutputDir()}
              className="bg-card hover:bg-muted inline-flex h-10 max-w-70 items-center gap-1.5 rounded-lg border px-3 text-left text-[12px] font-semibold transition-colors"
            >
              <FolderOpen
                className="size-3.5 shrink-0 opacity-60"
                aria-hidden
              />
              <span className="truncate font-mono text-[11px] font-normal">
                {outputDirLabel || '—'}
              </span>
            </button>
            {outputDirOverride && (
              <button
                type="button"
                onClick={() => dispatch(setOutputDirOverride(null))}
                className="text-muted-foreground hover:text-foreground text-[11px] font-medium underline"
              >
                {t('search.output_dir_reset')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Single-select batch dropdown. Options only — semantics (target value,
 * auto-adjust) are explained by the help popover, not inside the menu.
 *
 * @private
 */
function BatchDropdown({
  label,
  value,
  options,
  onSelect,
  disabled = false,
}: {
  label: string
  value: string
  disabled?: boolean
  options: {
    id: number
    label: string
    disabled?: boolean
    disabledReason?: string
  }[]
  onSelect: (id: number) => void
}) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground mb-1 text-[11px] font-semibold">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={label}
          className="bg-card hover:bg-muted data-[state=open]:border-brand-strong/40 inline-flex h-10 items-center justify-between gap-2 rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-50"
        >
          <span className="max-w-60 truncate">{value || '—'}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {options.map((o) => (
            <DropdownMenuItem
              key={o.id}
              disabled={o.disabled}
              title={o.disabled ? o.disabledReason : undefined}
              onClick={() => onSelect(o.id)}
              className="flex justify-between gap-4"
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span>{o.label}</span>
                {o.disabledReason && (
                  <span className="text-muted-foreground text-[10px] font-semibold">
                    {o.disabledReason}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default BatchSettingsBar
