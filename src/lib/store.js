import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getProject, saveProject, loadSettings, saveSettings } from './db.js'

// ---------- hash router ----------

const subscribeHash = (cb) => {
  addEventListener('hashchange', cb)
  return () => removeEventListener('hashchange', cb)
}

export function useRoute() {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash)
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
}

export const go = (...parts) => {
  location.hash = '/' + parts.map(encodeURIComponent).join('/')
}

// ---------- settings ----------

let settings = loadSettings()
const listeners = new Set()

export function useSettings() {
  const s = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => settings,
  )
  const set = useCallback((patch) => {
    settings = { ...settings, ...(typeof patch === 'function' ? patch(settings) : patch) }
    saveSettings(settings)
    listeners.forEach((l) => l())
  }, [])
  return [s, set]
}

// ---------- project (autosaved) ----------

export function useProject(id) {
  const [project, setProject] = useState(undefined)
  const pending = useRef(null)
  const timer = useRef(0)

  useEffect(() => {
    let alive = true
    setProject(undefined)
    getProject(id).then((p) => alive && setProject(p ?? null))
    return () => {
      alive = false
    }
  }, [id])

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    if (pending.current) {
      const p = pending.current
      pending.current = null
      return saveProject(p)
    }
  }, [])

  useEffect(() => {
    addEventListener('pagehide', flush)
    return () => {
      removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const update = useCallback(
    (fn) => {
      setProject((p) => {
        const next = { ...(typeof fn === 'function' ? fn(p) : { ...p, ...fn }), updatedAt: Date.now() }
        pending.current = next
        clearTimeout(timer.current)
        timer.current = setTimeout(flush, 400)
        return next
      })
    },
    [flush],
  )

  return [project, update, flush]
}
