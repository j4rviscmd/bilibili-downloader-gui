import { useInit } from '@/features/init'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

/**
 * Initialization page component.
 *
 * Runs the initialization sequence (ffmpeg check, cookie validation, etc.)
 * during app startup. The splash screen handles the visual UX, so this
 * component renders no visible UI. Redirects to /home on success or /error
 * on failure.
 */
function InitPage() {
  const navigate = useNavigate()
  const { initApp } = useInit()

  useEffect(() => {
    const runInit = async (): Promise<void> => {
      const result = await initApp()
      if (result.code === 0) {
        navigate('/home')
        return
      }
      const validErrorCodes = [1, 2, 3, 4, 5, 6]
      const errorCode = validErrorCodes.includes(result.code)
        ? result.code
        : 255
      navigate('/error', {
        state: { errorCode, errorDetail: result.detail },
        replace: true,
      })
    }

    runInit()
  }, [])

  return null
}

export default InitPage
