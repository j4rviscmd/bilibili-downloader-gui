import CircleIndicator from '@/components/lib/CircleIndicator'
import { initApp } from '@/features/init/initApp'
import { useInit } from '@/features/init/useInit'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'

function InitPage() {
  const navigate = useNavigate()
  const { processingFnc } = useInit()

  useEffect(() => {
    ;(async () => {
      const res = await initApp()
      if (res) {
        // navigate('/home')
      }
    })()
  }, [])

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center">
        <CircleIndicator />
        <div className="text-muted-foreground text-center text-xl font-bold">
          初期化中...
        </div>
        <div className="text-muted-foreground text-sm">{processingFnc}</div>
      </div>
    </div>
  )
}

export default InitPage
