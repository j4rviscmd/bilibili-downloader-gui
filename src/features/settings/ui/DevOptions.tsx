import { invoke } from '@tauri-apps/api/core'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'

import type { RootState } from '@/app/store'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useUser } from '@/features/user'

import { Switch } from '@/shared/animate-ui/radix/switch'
import { Label } from '@/shared/ui/label'

export function DevOptions() {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const { onChangeUser, getUserInfo } = useUser()
  const simulateLogout = useSelector(
    (state: RootState) => state.dev?.simulateLogout ?? false,
  )
  const [isOpen, setIsOpen] = useState(false)

  const handleToggleSimulateLogout = async (checked: boolean) => {
    // Set backend simulate logout flag (development mode only)
    try {
      await invoke('set_simulate_logout', { enabled: checked })
    } catch (error) {
      console.error('Failed to set simulate logout state:', error)
    }

    dispatch({ type: 'dev/setSimulateLogout', payload: checked })

    if (checked) {
      // Simulate non-logged-in state
      onChangeUser({
        code: 0,
        message: '',
        ttl: 1,
        data: {
          mid: undefined,
          uname: '',
          isLogin: false,
          wbiImg: {
            imgUrl: '',
            subUrl: '',
          },
        },
        hasCookie: false,
      })
    } else {
      // Restore actual user state
      await getUserInfo()
    }
  }

  // Only show in development mode
  if (!import.meta.env.DEV) {
    return null
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-dashed border-amber-500/30 bg-amber-50/50 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-100/50 dark:border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-400 dark:hover:bg-amber-900/30">
        <span>{t('settings.dev_options.title')}</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-4 rounded-lg border border-amber-500/20 bg-amber-50/30 p-4 dark:border-amber-500/10 dark:bg-amber-950/10">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label
              htmlFor="simulate-logout"
              className="text-sm font-medium text-amber-800 dark:text-amber-300"
            >
              {t('settings.dev_options.simulate_logout')}
            </Label>
            <p className="text-xs text-amber-600 dark:text-amber-400/80">
              {t('settings.dev_options.simulate_logout_description')}
            </p>
          </div>
          <Switch
            id="simulate-logout"
            checked={simulateLogout}
            onCheckedChange={handleToggleSimulateLogout}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
