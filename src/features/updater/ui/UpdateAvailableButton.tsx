import { useAppDispatch, useSelector } from '@/app/store'
import { Button } from '@/components/ui/button'
import { fetchReleaseNotes } from '@/features/updater/api/updaterApi'
import {
  setReleaseNotes,
  setShowDialog,
} from '@/features/updater/model/updaterSlice'
import { logger } from '@/shared/lib/logger'
import { ArrowUpCircle } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const OWNER = 'j4rviscmd' as const
const REPO = 'bilibili-downloader-gui' as const

/**
 * AppBar entry point for a pending app update (issue #599).
 *
 * Renders while an update is available — including versions the user
 * skipped: the startup dialog stays suppressed, but the offer must stay
 * discoverable and re-openable (ESC/X/overlay leave no other entry
 * besides the Settings manual check).
 *
 * Clicking opens the dialog immediately and refetches release notes in
 * the background (the suppressed startup path skips the fetch to save
 * the unauthenticated GitHub API quota).
 */
export function UpdateAvailableButton() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { updateAvailable, currentVersion } = useSelector(
    (state) => state.updater,
  )

  // Why open-first + always refetch: clearing releaseNotes to null and
  // opening the dialog right away makes its built-in spinner body the
  // loading indicator, so the button itself needs no spinner/disabled
  // state (the modal also swallows repeat clicks). The refetch always
  // runs because a failed startup stores the fallback message as a
  // non-null string — a freshness check would treat that failure as
  // success and never retry, even after the GitHub rate limit that
  // caused it has recovered.
  const handleClick = useCallback(async () => {
    dispatch(setReleaseNotes(null))
    dispatch(setShowDialog(true))
    try {
      const notes = await fetchReleaseNotes(OWNER, REPO, currentVersion ?? '')
      dispatch(setReleaseNotes(notes))
    } catch (e) {
      logger.error('Failed to fetch release notes', e)
      dispatch(setReleaseNotes(t('updater.no_release_notes')))
    }
  }, [dispatch, currentVersion, t])

  if (!updateAvailable) {
    return null
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-xs"
      onClick={handleClick}
    >
      <ArrowUpCircle className="size-3" />
      {t('updater.update_available')}
    </Button>
  )
}
