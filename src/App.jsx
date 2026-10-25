import { Suspense, lazy } from 'react'
import { useRoute } from './lib/store.js'
import { Toaster } from './components/ui.jsx'
import Home from './screens/Home.jsx'

const Plan = lazy(() => import('./screens/Plan.jsx'))
const Shoot = lazy(() => import('./screens/Shoot.jsx'))
const Wrap = lazy(() => import('./screens/Wrap.jsx'))
const Settings = lazy(() => import('./screens/Settings.jsx'))
const Guide = lazy(() => import('./screens/Guide.jsx'))

function Screen() {
  const [a, id, b, c] = useRoute()
  if (a === 'p' && id) {
    if (b === 'shoot') return <Shoot id={id} start={Number(c) || 0} />
    if (b === 'wrap') return <Wrap id={id} />
    return <Plan id={id} tab={c ?? b} />
  }
  if (a === 'settings') return <Settings />
  if (a === 'guide') return <Guide />
  return <Home />
}

export default function App() {
  return (
    <>
      <Suspense fallback={<div className="empty">กำลังโหลด…</div>}>
        <Screen />
      </Suspense>
      <Toaster />
    </>
  )
}
