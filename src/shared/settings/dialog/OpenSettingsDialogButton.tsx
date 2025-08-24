import { Settings } from '@/components/animate-ui/icons/settings'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/shared/settings/useSettings'
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
