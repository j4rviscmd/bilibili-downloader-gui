import { useTheme } from '@/app/contexts/ThemeContext'
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
} from '@/components/animate-ui/radix/sidebar'
import AppBar from '@/components/lib/AppBar/AppBar'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useInit } from '@/features/init/useInit'
import DownloadButton from '@/features/video/DownloadButton'
import DownloadingDialog from '@/features/video/DownloadingDialog'
import VideoForm1 from '@/features/video/VideoForm1'
import VideoForm2 from '@/features/video/VideoForm2'
import OpenSettingsDialogButton from '@/shared/settings/dialog/OpenSettingsDialogButton'
import SettingsDialog from '@/shared/settings/dialog/SettingsDialog'
import { useUser } from '@/shared/user/useUser'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

function HomePage() {
  const { initiated } = useInit()
  const navigate = useNavigate()
  const { user } = useUser()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (initiated) return
    navigate('/init')
  }, [initiated, navigate])

  return (
    <>
      <SidebarProvider defaultOpen={false}>
        <Sidebar>
          <SidebarHeader>
            {/* <SidebarMenu>
        <SidebarMenuItem>Item 1</SidebarMenuItem>
      </SidebarMenu> */}
          </SidebarHeader>
          <SidebarContent>
            {/* <SidebarGroup>
        <SidebarGroupLabel>Label 1</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>Item 1</SidebarMenuItem>
          <SidebarMenuItem>Item 2</SidebarMenuItem>
          <SidebarMenuItem>Item 3</SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Label 2</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>Item 1</SidebarMenuItem>
          <SidebarMenuItem>Item 2</SidebarMenuItem>
          <SidebarMenuItem>Item 3</SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup> */}
          </SidebarContent>
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
          <div className="n flex h-full w-full flex-col">
            <AppBar user={user} theme={theme} setTheme={setTheme} />
            <SidebarTrigger size={'lg'} className="m-1" />
            <ScrollArea className="flex size-full">
              <div className="box-border flex w-full flex-col items-center justify-center p-3">
                <div className="flex h-full w-4/5 flex-col justify-center gap-12">
                  <div className="block">
                    <VideoForm1 />
                  </div>
                  <div className="block">
                    <VideoForm2 />
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
