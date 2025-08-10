import { useSelector } from '@/app/store'

function InputFields() {
  const url = useSelector((state) => state.input.url)

  return <div>InputUrl</div>
}

export default InputFields
