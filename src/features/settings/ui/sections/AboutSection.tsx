import { AboutDialog } from '@/features/about'
import { OpenLogsButton } from '@/features/settings/ui/OpenLogsButton'
import { ReleaseNotesSection } from '@/features/settings/ui/ReleaseNotesSection'
import { UpdateCheckButton } from '@/features/settings/ui/UpdateCheckButton'

/**
 * About category: app maintenance actions — update check, release notes,
 * about dialog, and log access.
 */
export function AboutSection() {
  return (
    <div className="space-y-6">
      <div className="flex w-full flex-wrap items-end gap-2">
        <UpdateCheckButton />
        <ReleaseNotesSection />
        <AboutDialog />
        <OpenLogsButton />
      </div>
    </div>
  )
}
