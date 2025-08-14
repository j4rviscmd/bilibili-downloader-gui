import { RippleButton } from '@/components/animate-ui/buttons/ripple'
import { useVideoInfo } from '@/features/video/useVideoInfo'

function DownloadButton() {
  const { download, isForm1Valid, isForm2Valid } = useVideoInfo()

  return (
    <RippleButton onClick={download} disabled={!(isForm1Valid && isForm2Valid)}>
      はじめる
    </RippleButton>
  )
}

export default DownloadButton
