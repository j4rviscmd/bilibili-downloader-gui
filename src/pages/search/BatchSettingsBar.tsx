import { interceptInvokeError } from '@/app/lib/invokeErrorHandler'
import type { RootState } from '@/app/store'
import { store, useAppDispatch, useSelector } from '@/app/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

  // Lazily fetch qualities/subtitles for selected parts that have none
  // yet (same requests the per-part accordion issues on first open).
  useEffect(() => {
    if (video.parts.length === 0) return
    const missing = selectedIndices.filter(
      (i) => input.partInputs[i]?.videoQualities === undefined,
    )
    if (missing.length === 0) return
    missing.forEach((i) =>
      dispatch(setQualitiesLoading({ index: i, loading: true })),
    )
    missing.forEach(async (i) => {
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
    const missing = selectedIndices.filter(
      (i) => input.partInputs[i]?.subtitles === undefined,
    )
    if (missing.length === 0) return
    missing.forEach((i) =>
      dispatch(setSubtitlesLoading({ index: i, loading: true })),
    )
    missing.forEach(async (i) => {
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
    const labels = new Map<string, string>()
    for (const i of selectedIndices) {
      for (const s of input.partInputs[i]?.subtitles ?? []) {
        if (!labels.has(s.lan)) labels.set(s.lan, s.lanDoc)
      }
    }
    return labels
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
  const subSummary =
    displaySubMode === 'off'
      ? t('video.subtitle_off')
      : `${t(displaySubMode === 'soft' ? 'video.subtitle_soft' : 'video.subtitle_hard')} · ${displaySubLangs.length}`

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
        <BatchDropdown
          label={t('video.subtitle')}
          value={subSummary}
          options={[
            { id: 0, label: t('video.subtitle_off') },
            { id: 1, label: t('video.subtitle_soft') },
            { id: 2, label: t('video.subtitle_hard') },
          ]}
          onSelect={(id) => {
            const mode = (['off', 'soft', 'hard'] as const)[id]!
            applySubtitle(
              mode,
              mode === 'off'
                ? []
                : subLangs.length > 0
                  ? subLangs
                  : effectiveSubLangs,
            )
          }}
          disabled={selectedIndices.length === 0}
        />
        {displaySubMode !== 'off' && langUnion.size > 0 && (
          <div className="flex flex-col">
            <span className="text-muted-foreground mb-1 text-[11px] font-semibold">
              {t('video.subtitle_select_multiple')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[...langUnion.entries()].map(([lan, lanDoc]) => {
                const on = subLangs.includes(lan)
                return (
                  <button
                    key={lan}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      applySubtitle(
                        displaySubMode ?? 'soft',
                        on
                          ? (subLangs.length > 0
                              ? subLangs
                              : effectiveSubLangs
                            ).filter((l) => l !== lan)
                          : [
                              ...(subLangs.length > 0
                                ? subLangs
                                : effectiveSubLangs),
                              lan,
                            ],
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      on
                        ? 'border-brand-strong/40 bg-brand-strong/10 text-brand-strong dark:text-brand'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {lanDoc}
                  </button>
                )
              })}
            </div>
          </div>
        )}
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
