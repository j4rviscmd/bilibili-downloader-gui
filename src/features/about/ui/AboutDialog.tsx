import appIcon from '@/assets/icon.png'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import { logger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/button'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Check, Copy, Info } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getAppInfo } from '../api/aboutApi'
import type { AppInfo } from '../types'

const REPO_URL = 'https://github.com/j4rviscmd/bilibili-downloader-gui'

/** Format an OS line for display from the raw os_name + os_version.
 *
 * On Windows the NT kernel version stays "10.0" for both 10 and 11, so
 * we distinguish by build number (>= 22000 => Windows 11) to avoid the
 * misleading "Windows 10" label on Windows 11 machines. */
const formatOsLine = (osName: string, osVersion: string): string => {
  switch (osName) {
    case 'windows': {
      const build = osVersion.split('.')[2]
      if (!build) return 'Windows'
      // Why: 22000 is the official first Windows 11 build; Win10 and Win11
      // share NT kernel "10.0" so the build number is the only signal.
      const major = Number(build) >= 22000 ? 'Windows 11' : 'Windows 10'
      return `${major} (build ${build})`
    }
    case 'macos':
      return osVersion ? `macOS ${osVersion}` : 'macOS'
    case 'linux':
      return osVersion ? `Linux ${osVersion}` : 'Linux'
    default:
      return `${osName} ${osVersion}`.trim() || osName
  }
}

/** A labeled key/value row used in the About dialog body. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

/**
 * About dialog trigger + dialog.
 *
 * Renders an "About" button that opens a dialog showing the app icon,
 * version, environment info (OS / architecture / Tauri version) and a
 * link to the GitHub repository. Environment info is fetched on first
 * open via the `get_app_info` command and is intentionally reusable for
 * the future bug-report prefill flow.
 *
 * @example
 * ```tsx
 * <AboutDialog />
 * ```
 */
export function AboutDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [copied, setCopied] = useState(false)

  // Lazily fetch app info when the dialog opens; cached in state so
  // reopening doesn't refetch.
  useEffect(() => {
    if (!open || info) return
    getAppInfo()
      .then(setInfo)
      .catch((e) => logger.error('AboutDialog: failed to load app info', e))
  }, [open, info])

  // Reset the copied flag when the dialog closes so it always starts fresh.
  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  const handleOpenRepo = useCallback(() => {
    openUrl(REPO_URL).catch((e) =>
      logger.error('AboutDialog: failed to open repository', e),
    )
  }, [])

  // Copy environment info as a Markdown list, ready to paste into a GitHub
  // bug_report body. Separate from the (future) bug-report launch flow,
  // which will reuse `getAppInfo` directly.
  const handleCopy = useCallback(async () => {
    if (!info) return
    const text = [
      `- App: ${t('about.app_name')} v${info.app_version}`,
      `- OS: ${formatOsLine(info.os_name, info.os_version)}`,
      `- Architecture: ${info.arch}`,
      `- Tauri: ${info.tauri_version}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(t('about.copied'))
      window.setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      logger.error('AboutDialog: failed to copy info', e)
      toast.error(t('about.copy_failed'))
    }
  }, [info, t])

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Info className="mr-2 size-4" />
        {t('about.button')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <img
                src={appIcon}
                alt=""
                aria-hidden
                className="size-12 rounded-md"
              />
              <span>{t('about.app_name')}</span>
            </DialogTitle>
            <DialogDescription>{t('about.description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Row
              label={t('about.version')}
              value={info ? `v${info.app_version}` : '-'}
            />

            <div className="space-y-2">
              <Row
                label={t('about.os')}
                value={info ? formatOsLine(info.os_name, info.os_version) : '-'}
              />
              <Row label={t('about.architecture')} value={info?.arch ?? '-'} />
              <Row
                label={t('about.tauri_version')}
                value={info?.tauri_version ?? '-'}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-sm">
                {t('about.repository')}
              </span>
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={handleOpenRepo}
              >
                {REPO_URL.replace('https://', '')}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              disabled={!info}
              className="w-full sm:w-auto"
            >
              {copied ? (
                <Check className="mr-2 size-4" />
              ) : (
                <Copy className="mr-2 size-4" />
              )}
              {t(copied ? 'about.copied' : 'about.copy')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
