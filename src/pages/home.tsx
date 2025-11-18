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
import { Separator } from '@/components/ui/separator'
import { useInit } from '@/features/init/useInit'
import { useVideoInfo } from '@/features/video'
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
  const { video, duplicateIndices } = useVideoInfo()

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
