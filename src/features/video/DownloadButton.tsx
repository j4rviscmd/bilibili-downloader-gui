import { RippleButton } from '@/components/animate-ui/buttons/ripple'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { useTranslation } from 'react-i18next'

function DownloadButton() {
  const { download, isForm1Valid, isForm2Valid } = useVideoInfo()
  const { t } = useTranslation()

  return (
    <RippleButton onClick={download} disabled={!(isForm1Valid && isForm2Valid)}>
      {t('actions.download')}
    </RippleButton>
  )
}

export default DownloadButton
