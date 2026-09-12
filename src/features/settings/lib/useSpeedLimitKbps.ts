import { useSettings } from '@/features/settings/useSettings'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Constraint: range and default must stay in sync with the backend
// (SPEED_LIMIT_MIN_KBPS / SPEED_LIMIT_MAX_KBPS in src-tauri constants.rs and
// the FE seed in settingsSlice.ts). The backend resolver clamps out-of-range
// stored values, but the FE validates first so the user sees the error
// instead of a silent clamp (issue #421).
export const SPEED_LIMIT_MIN_KBPS = 100
export const SPEED_LIMIT_MAX_KBPS = 10_000_000
export const SPEED_LIMIT_DEFAULT_KBPS = 1000

/**
 * Draft-state logic for the speed-limit kbps input (issue #421), used by
 * the Settings screen's DownloadSection.
 *
 * The draft commits on blur/Enter only, so per-keystroke typing never
 * fires a settings patch. Both fields are saved atomically on toggle so
 * the backend never sees enabled-without-kbps.
 */
export function useSpeedLimitKbps() {
  const { t } = useTranslation()
  const { settings, saveByForm } = useSettings()
  const [kbpsDraft, setKbpsDraft] = useState(
    String(settings.downloadSpeedLimitKbps ?? SPEED_LIMIT_DEFAULT_KBPS),
  )
  const [kbpsError, setKbpsError] = useState<string | null>(null)

  const parsedKbps = Number(kbpsDraft)
  const kbpsIsValid =
    kbpsDraft.trim() !== '' &&
    Number.isInteger(parsedKbps) &&
    parsedKbps >= SPEED_LIMIT_MIN_KBPS &&
    parsedKbps <= SPEED_LIMIT_MAX_KBPS

  // Re-sync the draft when the persisted kbps changes externally (the
  // settings page refetches settings.json when it becomes visible again,
  // e.g. returning from another route) — otherwise a backend-reloaded
  // value would hide under a stale draft. Own commits land on an
  // unchanged value, so typing never fights this effect.
  useEffect(() => {
    setKbpsDraft(
      String(settings.downloadSpeedLimitKbps ?? SPEED_LIMIT_DEFAULT_KBPS),
    )
    setKbpsError(null)
  }, [settings.downloadSpeedLimitKbps])

  /** Commits the draft kbps on blur/Enter; invalid drafts show an error. */
  const commitKbps = () => {
    if (!kbpsIsValid) {
      // toLocaleString: group digits by the user's display language
      // (e.g. 10,000,000) instead of a raw 10000000.
      setKbpsError(
        t('settings.download_speed_limit_invalid', {
          min: SPEED_LIMIT_MIN_KBPS.toLocaleString(),
          max: SPEED_LIMIT_MAX_KBPS.toLocaleString(),
        }),
      )
      return
    }
    setKbpsError(null)
    if (parsedKbps !== settings.downloadSpeedLimitKbps) {
      saveByForm({ downloadSpeedLimitKbps: parsedKbps })
    }
  }

  /**
   * Toggles the limit switch, saving BOTH fields atomically. Enabling with
   * an invalid draft resets the draft to the default instead of guessing
   * from garbage; disabling with an invalid draft patches only the switch
   * (a NaN draft must never reach the JSON patch).
   */
  const handleLimitToggle = (checked: boolean) => {
    if (checked && !kbpsIsValid) {
      setKbpsDraft(String(SPEED_LIMIT_DEFAULT_KBPS))
      setKbpsError(null)
      saveByForm({
        downloadSpeedLimitEnabled: true,
        downloadSpeedLimitKbps: SPEED_LIMIT_DEFAULT_KBPS,
      })
      return
    }
    if (kbpsIsValid) {
      saveByForm({
        downloadSpeedLimitEnabled: checked,
        downloadSpeedLimitKbps: parsedKbps,
      })
    } else {
      saveByForm({ downloadSpeedLimitEnabled: checked })
    }
  }

  return {
    enabled: settings.downloadSpeedLimitEnabled ?? false,
    kbpsDraft,
    // Editing clears a shown error so it only appears after a failed
    // commit attempt, not while correcting it — the hook owns both pieces
    // of state, so consumers get one call instead of two.
    setKbpsDraft: (value: string) => {
      setKbpsDraft(value)
      setKbpsError(null)
    },
    kbpsError,
    commitKbps,
    handleLimitToggle,
  }
}
