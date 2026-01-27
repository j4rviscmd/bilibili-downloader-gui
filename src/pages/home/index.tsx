import { store } from '@/app/store'
import { useTheme } from '@/app/providers/ThemeContext'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/shared/animate-ui/radix/sidebar'
import AppBar from '@/shared/ui/AppBar/AppBar'
import { Button } from '@/shared/ui/button'
import { ScrollArea, ScrollBar } from '@/shared/ui/scroll-area'
import { Separator } from '@/shared/ui/separator'
import { useInit } from '@/features/init'
import {
  useVideoInfo,
  VideoForm1,
  VideoForm2,
  DownloadButton,
  DownloadingDialog,
  selectAll,
  deselectAll,
} from '@/features/video'
import OpenSettingsDialogButton from '@/features/settings/dialog/OpenSettingsDialogButton'
import SettingsDialog from '@/features/settings/dialog/SettingsDialog'
import { useUser } from '@/features/user'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

/**
 * Home page component (main application view).
 *
 * Displays the primary UI for video downloads including:
 * - Sidebar with settings button
 * - App bar with user info, language selector, and theme toggle
 * - Video URL input form (Step 1)
 * - Video parts configuration forms (Step 2)
 * - Select all/deselect all buttons
 * - Download button
 * - Download progress dialog
 *
 * Redirects to /init if the app is not initialized.
 *
 * @example
 * ```tsx
 * <Route path="/home" element={<HomePage />} />
 * ```
 */
function HomePage() {
  const { initiated } = useInit()
  const navigate = useNavigate()
  const { user } = useUser()
  const { theme, setTheme } = useTheme()
  const { video, duplicateIndices } = useVideoInfo()
  const { t } = useTranslation()

  const handleSelectAll = () => {
    store.dispatch(selectAll())
  }

  const handleDeselectAll = () => {
    store.dispatch(deselectAll())
  }

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <>
      <SidebarProvider defaultOpen={false}>
        <Sidebar>
          <SidebarHeader />
          <SidebarContent />
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <OpenSettingsDialogButton />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div className="flex h-full w-full flex-col">
            <header className="bg-accent flex">
              <SidebarTrigger
                size={'lg'}
                className="h-full cursor-pointer shadow-md"
              />
              <AppBar user={user} theme={theme} setTheme={setTheme} />
            </header>
            <ScrollArea
              style={{
                height: 'calc(100dvh - 2.3rem)',
              }}
              className="flex w-full"
            >
              <div className="box-border flex w-full flex-col items-center justify-center p-3">
                <div className="flex h-full w-4/5 flex-col justify-center gap-3">
                  <div className="block">
                    <VideoForm1 />
                  </div>
                  <Separator className="my-3" />
                  {video.parts.length > 0 && (
                    <div className="flex items-center gap-2 px-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSelectAll}
                      >
                        {t('video.select_all')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDeselectAll}
                      >
                        {t('video.deselect_all')}
                      </Button>
                    </div>
                  )}
                  <div className="block">
                    {video.parts.map((_v, idx) => (
                      <VideoForm2
                        key={idx}
                        video={video}
                        page={idx + 1}
                        isDuplicate={duplicateIndices.includes(idx)}
                      />
                    ))}
                  </div>
                  <div className="box-border flex w-full justify-center p-3">
                    <DownloadButton />
                  </div>
                </div>
              </div>
              <ScrollBar />
            </ScrollArea>
            <DownloadingDialog />
          </div>
        </SidebarInset>
      </SidebarProvider>
      <SettingsDialog />
    </>
  )
}

export default HomePage
