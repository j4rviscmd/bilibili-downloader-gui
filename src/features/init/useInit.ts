import { store, type RootState } from '@/app/store'
import { setInitiated as setValue } from '@/features/init/initSlice'
import { useSelector } from 'react-redux'

export const useInit = () => {
  const initiated = useSelector((state: RootState) => state.init.initiated)
  const processingFnc = useSelector(
    (state: RootState) => state.init.processingFnc,
  )

  const setInitiated = (value: boolean) => {
    store.dispatch(setValue(value))
  }

  return {
    initiated,
    processingFnc,
    setInitiated,
  }
}
