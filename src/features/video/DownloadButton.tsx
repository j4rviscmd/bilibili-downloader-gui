import { RippleButton } from '@/components/animate-ui/buttons/ripple'
import { useVideoInfo } from '@/features/video/useVideoInfo'

function DownloadButton() {
  const { download } = useVideoInfo()

  return <RippleButton onClick={download}>はじめる</RippleButton>
}

export default DownloadButton
