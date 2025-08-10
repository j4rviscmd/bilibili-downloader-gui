import { useSelector } from '@/app/store'

function InputUrl() {
  const url = useSelector((state) => state.input.url)
  return <div>InputUrl</div>
}

export default InputUrl
