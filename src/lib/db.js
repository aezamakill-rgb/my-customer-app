// IndexedDB storage: works on every modern browser (incl. iOS Safari) and
// keeps large video Blobs on disk instead of in memory.

const DB_NAME = 'kinshot'
let dbp

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('projects', { keyPath: 'id' })
      db.createObjectStore('media')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

async function run(store, mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'))
  })
}

export const listProjects = async () =>
  ((await run('projects', 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
export const getProject = (id) => run('projects', 'readonly', (s) => s.get(id))
export const saveProject = (p) => run('projects', 'readwrite', (s) => s.put(p))

export async function deleteProject(p) {
  for (const t of p.takes) await deleteMedia(t.id)
  await run('projects', 'readwrite', (s) => s.delete(p.id))
}

export const putMedia = (id, blob) => run('media', 'readwrite', (s) => s.put(blob, id))
export const getMedia = (id) => run('media', 'readonly', (s) => s.get(id))
export const deleteMedia = (id) => run('media', 'readwrite', (s) => s.delete(id))

/** Ask the browser not to evict recordings under storage pressure. */
export async function persistStorage() {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export async function storageInfo() {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null
  } catch {
    return null
  }
}

// ---------- settings (small, per-device) ----------

const SETTINGS_KEY = 'kinshot.settings'

export const DEFAULT_SETTINGS = {
  wpm: 170,
  prompterSize: 34,
  prompterMirror: false,
  prompterMode: 'auto', // auto | voice | manual
  countdown: 3,
  grid: true,
  level: true,
  safeZone: true,
  resolution: '1080',
  fps: 30,
  aiMode: 'paste', // paste | api
  keys: { claude: '', openai: '', gemini: '' },
  models: { claude: 'claude-opus-5-5', openai: '', gemini: '' },
  roles: { research: 'gemini', write: 'claude', direct: 'openai' },
  oneShotProvider: 'gemini',
  previewFull: true,
  previewMirror: true,
  prompterOverlay: false,
  brollAutoStop: true,
  kincutUrl: 'https://aezamakill-rgb.github.io/kincut/',
}

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') ?? {}
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      keys: { ...DEFAULT_SETTINGS.keys, ...s.keys },
      models: { ...DEFAULT_SETTINGS.models, ...s.models },
      roles: { ...DEFAULT_SETTINGS.roles, ...s.roles },
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* private mode: settings live for this session only */
  }
}
