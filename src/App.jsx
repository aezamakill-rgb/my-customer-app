import { Suspense, lazy } from 'react'
import { useRoute, go } from './lib/store.js'
import { takeSharedLaunch, getPending } from './lib/handoff.js'
import { Toaster } from './components/ui.jsx'
import Home from './screens/Home.jsx'

const Plan = lazy(() => import('./screens/Plan.jsx'))
const Shoot = lazy(() => import('./screens/Shoot.jsx'))
const Wrap = lazy(() => import('./screens/Wrap.jsx'))
const Settings = lazy(() => import('./screens/Settings.jsx'))
const Guide = lazy(() => import('./screens/Guide.jsx'))

// Back from an AI app: if the phone closed KinShot meanwhile, or an answer
// was shared in, reopen the project that is waiting for it.
const shared = takeSharedLaunch()
const pending = getPending()
let resumed = false
try {
  resumed = sessionStorage.getItem('kinshot.resumed') === '1'
  sessionStorage.setItem('kinshot.resumed', '1')
} catch {
  /* ignore */
}
if (pending && (shared || (!resumed && !location.hash.replace(/^#\/?/, '')))) {
  go('p', pending.projectId, 'plan', 'team')
}

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
