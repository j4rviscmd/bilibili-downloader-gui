import { Button } from '@/components/ui/button'
import { useCount } from '@/features/count/useCount'
import './App.css'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'

function App() {
  const { value, setAbsoluteCount } = useCount()

  return (
    <>
      <Button>Shadcn button</Button>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setAbsoluteCount(value + 1)}>
          count is {value}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
