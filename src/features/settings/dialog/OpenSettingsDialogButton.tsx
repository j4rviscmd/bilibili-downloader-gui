import { Settings } from '@/shared/animate-ui/icons/settings'
import { Button } from '@/shared/ui/button'
import { useSettings } from '@/features/settings/useSettings'
import { useState } from 'react'

function OpenSettingsDialogButton() {
  const [hover, setHover] = useState(false)
  const { updateOpenDialog } = useSettings()

  return (
    <Button
      className="w-full"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => updateOpenDialog(true)}
    >
      <Settings animate={hover} />
      設定
    </Button>
  )
}

export default OpenSettingsDialogButton
