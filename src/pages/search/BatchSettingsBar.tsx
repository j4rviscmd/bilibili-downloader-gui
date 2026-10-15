import { interceptInvokeError } from '@/app/lib/invokeErrorHandler'
import type { RootState } from '@/app/store'
import { store, useAppDispatch, useSelector } from '@/app/store'
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
import {
  fetchBangumiPartQualities,
  fetchPartQualities,
  fetchSubtitlesForPart,
} from '@/features/video/api/fetchVideoInfo'
import {
  AUDIO_LADDER_IDS,
  LOGIN_REQUIRED_VIDEO_IDS,
  SUBTITLE_LANGUAGES,
  unionIds,
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
  setOutputDirOverride,
  setPartQualities,
  setPartSubtitles,
  setQualitiesLoading,
  setSubtitlesLoading,
  updatePartInputByIndex,
  updateSubtitleConfig,
} from '@/features/video/model/inputSlice'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { ChevronDown, FolderOpen, Info } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
export function BatchSettingsBar({
  pageRange,
}: {
  pageRange: { startIndex: number; endIndex: number }
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { video, input } = useVideoInfo()
  const isLoggedIn = useSelector((state: RootState) => state.user.data.isLogin)

  const selectedIndices = useMemo(
    () =>
      input.partInputs
        .map((pi, i) => (pi.selected ? i : -1))
        .filter((i) => i >= 0),
    [input.partInputs],
  )

  // Sample size for the batch bar's eager quality/subtitle fetch. Parts
  // of the same video typically share the same quality ladder, so a few
  // are enough to build a representative union. Without this cap,
  // selecting 100 parts would fire 200 concurrent API calls and get
  // rate-limited by bilibili. Parts outside the sample still fetch
  // individually when their accordion opens (the existing lazy path).
  // ponytail: 5 is a guess; raise if quality ladders actually vary more
  // across parts than expected.
  const FETCH_SAMPLE = 5

  useEffect(() => {
    if (video.parts.length === 0) return
    const sample = selectedIndices
      .filter((i) => input.partInputs[i]?.videoQualities === undefined)
      .slice(0, FETCH_SAMPLE)
    if (sample.length === 0) return
    sample.forEach((i) =>
      dispatch(setQualitiesLoading({ index: i, loading: true })),
    )
    sample.forEach(async (i) => {
      const part = video.parts[i]
      if (!part) return
      try {
        const [vq, aq] =
          video.contentType === 'bangumi' && part.epId
            ? await fetchBangumiPartQualities(part.epId, part.cid)
            : await fetchPartQualities(video.bvid, part.cid)
        dispatch(
          setPartQualities({
            index: i,
            videoQualities: vq,
            audioQualities: aq,
          }),
        )
      } catch (e) {
        await interceptInvokeError(store, e)
        dispatch(
          setPartQualities({
            index: i,
            videoQualities: [],
            audioQualities: [],
          }),
        )
      }
    })
  }, [selectedIndices, input.partInputs, video, dispatch])

  useEffect(() => {
    if (video.parts.length === 0) return
    const sample = selectedIndices
      .filter((i) => input.partInputs[i]?.subtitles === undefined)
      .slice(0, FETCH_SAMPLE)
    if (sample.length === 0) return
    sample.forEach((i) =>
      dispatch(setSubtitlesLoading({ index: i, loading: true })),
    )
    sample.forEach(async (i) => {
      const part = video.parts[i]
      if (!part) return
      try {
        const subtitles = await fetchSubtitlesForPart(video.bvid, part.cid)
        dispatch(setPartSubtitles({ index: i, subtitles }))
      } catch {
        dispatch(setPartSubtitles({ index: i, subtitles: [] }))
      }
    })
  }, [selectedIndices, input.partInputs, video, dispatch])

  const videoUnion = useMemo(
    () =>
      unionIds(
        Object.keys(VIDEO_QUALITIES_MAP).map(Number),
        selectedIndices.map((i) =>
          input.partInputs[i]?.videoQualities?.map((q) => q.id),
        ),
      ),
    [selectedIndices, input.partInputs],
  )
  const audioUnion = useMemo(
    () =>
      unionIds(
        Object.keys(AUDIO_QUALITIES_MAP)
          .map(Number)
          .sort((a, b) => b - a),
        selectedIndices.map((i) =>
          input.partInputs[i]?.audioQualities?.map((q) => q.id),
        ),
      ),
    [selectedIndices, input.partInputs],
  )
  const langUnion = useMemo(() => {
    const available = new Set<string>()
    for (const i of selectedIndices) {
      for (const s of input.partInputs[i]?.subtitles ?? []) {
        // Normalize "ai-ja" → "ja": AI-generated and manual subtitles
        // share the same language slot — the user picks a language, not
        // a generation method.
        available.add(s.lan.replace(/^ai-/, ''))
      }
    }
    return available
  }, [selectedIndices, input.partInputs])

  // Batch targets: the trigger shows the EFFECTIVE value (first selected
  // part's setting, falling back to the top of each union = the account's
  // best-effort default) so the user always sees what a download would
  // use. An explicit dropdown pick stores an override in state AND
  // dispatches to every selected part; merely changing the selection
  // never dispatches.
  const [videoOverride, setVideoOverride] = useState<number | null>(null)
  const [audioOverride, setAudioOverride] = useState<number | null>(null)
  const [subMode, setSubMode] = useState<'off' | 'soft' | 'hard' | null>(null)
  const [subLangs, setSubLangs] = useState<string[]>([])
  const first =
    selectedIndices.length > 0
      ? input.partInputs[selectedIndices[0]!]
      : undefined
  const targetVideo =
    videoOverride ??
    (first?.videoQuality ? Number(first.videoQuality) : (videoUnion[0] ?? null))
  const targetAudio =
    audioOverride ??
    (first?.audioQuality ? Number(first.audioQuality) : (audioUnion[0] ?? null))
  const effectiveSubMode = first?.subtitle?.mode ?? 'off'
  const effectiveSubLangs = first?.subtitle?.selectedLans ?? []

  const applyVideo = useCallback(
    (id: number) => {
      setVideoOverride(id)
      selectedIndices.forEach((i) =>
        dispatch(
          updatePartInputByIndex({ index: i, videoQuality: String(id) }),
        ),
      )
    },
    [selectedIndices, dispatch],
  )
  const applyAudio = useCallback(
    (id: number) => {
      setAudioOverride(id)
      selectedIndices.forEach((i) =>
        dispatch(
          updatePartInputByIndex({ index: i, audioQuality: String(id) }),
        ),
      )
    },
    [selectedIndices, dispatch],
  )
  const applySubtitle = useCallback(
    (mode: 'off' | 'soft' | 'hard', langs: string[]) => {
      setSubMode(mode)
      setSubLangs(langs)
      selectedIndices.forEach((i) =>
        dispatch(
          updateSubtitleConfig({
            index: i,
            config: { mode, selectedLans: langs },
          }),
        ),
      )
    },
    [selectedIndices, dispatch],
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

  // Subtitle display: an explicit override wins; otherwise reflect the
  // first selected part's effective config.
  const displaySubMode = subMode ?? effectiveSubMode
  const displaySubLangs = subLangs.length > 0 ? subLangs : effectiveSubLangs
  const modeLabel = t(
    displaySubMode === 'soft'
      ? 'video.subtitle_soft'
      : displaySubMode === 'hard'
        ? 'video.subtitle_hard'
        : 'video.subtitle_off',
  )
  // Fixed-list labels keep the trigger consistent with the dropdown
  // even before subtitles are fetched (the lazy fetch hasn't landed yet).
  const langLabels = displaySubLangs.map(
    (l) => SUBTITLE_LANGUAGES.find((s) => s.lan === l)?.label ?? l,
  )
  const subSummary =
    displaySubMode === 'off'
      ? modeLabel
      : `${modeLabel} ${langLabels.join(displaySubMode === 'soft' ? ' + ' : ' → ')}`

  return (
    <div className="bg-card/95 sticky top-14 z-15 mt-3 rounded-xl border shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <span className="text-xs font-bold">{t('search.batch_title')}</span>
        <span className="text-muted-foreground text-[11px]">
          {t('search.batch_applies', { count: selectedIndices.length })}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch(selectPageAll(pageRange))}
          >
            {t('video.select_all_page')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch(deselectPageAll(pageRange))}
          >
            {t('video.deselect_all_page')}
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
            const inUnion = videoUnion.includes(id)
            const isVip = VIP_VIDEO_IDS.has(id)
            const needsLogin = !isLoggedIn && LOGIN_REQUIRED_VIDEO_IDS.has(id)
            return {
              id,
              label: label(id),
              disabled: !inUnion || isVip || needsLogin,
              disabledReason: isVip
                ? t('search.reason_vip')
                : needsLogin
                  ? t('search.reason_login')
                  : !inUnion
                    ? t('search.reason_unavailable')
                    : undefined,
            }
          })}
          disabled={selectedIndices.length === 0}
          onSelect={(id) => applyVideo(id)}
        />
        <BatchDropdown
          label={t('video.audio_quality_label')}
          value={targetAudio != null ? label(targetAudio) : ''}
          options={AUDIO_LADDER_IDS.map((id) => {
            const inUnion = audioUnion.includes(id)
            const isVip = VIP_AUDIO_IDS.has(id)
            return {
              id,
              label: label(id),
              disabled: !inUnion || isVip,
              disabledReason: isVip
                ? t('search.reason_vip')
                : !inUnion
                  ? t('search.reason_unavailable')
                  : undefined,
            }
          })}
          onSelect={(id) => applyAudio(id)}
          disabled={selectedIndices.length === 0}
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
              disabled={selectedIndices.length === 0}
              aria-label={t('video.subtitle')}
              className="bg-card hover:bg-muted data-[state=open]:border-brand-strong/40 inline-flex h-10 items-center justify-between gap-2 rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-50"
            >
              <span className="max-w-60 truncate">{subSummary || '—'}</span>
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
                  onClick={() =>
                    applySubtitle(mode, mode === 'off' ? [] : displaySubLangs)
                  }
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
              {SUBTITLE_LANGUAGES.map(({ lan, label }) => {
                const available = langUnion.has(lan)
                const idx = displaySubLangs.indexOf(lan)
                const selected = idx >= 0
                return (
                  <DropdownMenuItem
                    key={lan}
                    disabled={!available}
                    onSelect={(e) => {
                      // Keep the menu open: language selection is
                      // multi-select in one visit.
                      e.preventDefault()
                    }}
                    onClick={() => {
                      if (!available) return
                      const newLangs = selected
                        ? displaySubLangs.filter((l) => l !== lan)
                        : [...displaySubLangs, lan]
                      // While mode is "off", a language click only
                      // stores the local selection (mockup behavior:
                      // pre-select then pick a mode). Dispatching here
                      // would set parts to mode=off WITH languages —
                      // a nonsensical state.
                      if (displaySubMode === 'off') {
                        setSubLangs(newLangs)
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
                    {selected ? (
                      <span className="text-muted-foreground text-[10px] font-semibold">
                        {displaySubMode === 'soft'
                          ? '✓'
                          : t('search.subtitle_priority', {
                              count: idx + 1,
                            })}
                      </span>
                    ) : !available ? (
                      <span className="text-muted-foreground text-[10px] font-semibold">
                        {t('search.reason_unavailable')}
                      </span>
                    ) : null}
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
