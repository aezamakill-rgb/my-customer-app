// Moving prompts out to the AI apps and answers back in with as few taps
// and app switches as possible.

const PENDING_KEY = 'kinshot.pendingAI'
const INCOMING_KEY = 'kinshot.incoming'
const PENDING_TTL = 2 * 60 * 60 * 1000

const isTouch = () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false

/**
 * Send `text` to an AI app. Phones: the system share sheet (tap the
 * Gemini/ChatGPT/Claude app and the prompt lands in its input). Desktop or
 * no share sheet: copy and open the web app. The text is copied either way.
 * @returns 'shared' | 'opened' | 'cancelled'
 */
export async function sendToApp(text, appUrl) {
  // Start the copy without awaiting so the share call keeps the user gesture (Safari).
  const copied = navigator.clipboard?.writeText(text).catch(() => {})
  if (isTouch() && navigator.share) {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
      /* share failed: fall back to opening the app */
    }
  }
  await copied
  window.open(appUrl, '_blank', 'noopener')
  return 'opened'
}

/** Read the clipboard; `quiet` only reads when permission is already granted. */
export async function readClipboard({ quiet = false } = {}) {
  if (!navigator.clipboard?.readText) return null
  if (quiet) {
    try {
      const st = await navigator.permissions?.query({ name: 'clipboard-read' })
      if (st?.state !== 'granted') return null
    } catch {
      return null // Safari/Firefox: reading needs a tap
    }
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}

// ---------- remember which AI step is waiting for an answer ----------

export function setPending(p) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify({ ...p, at: Date.now() }))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    /* storage unavailable */
  }
}

export function getPending() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null')
    return p && Date.now() - p.at < PENDING_TTL ? p : null
  } catch {
    return null
  }
}

// ---------- Android share target: AI app → Share → KinShot ----------

/** Pick up text shared into the app (manifest share_target, GET params). */
export function takeSharedLaunch(loc = location) {
  const q = new URLSearchParams(loc.search)
  const parts = ['share_title', 'share_text', 'share_url'].map((k) => q.get(k)).filter(Boolean)
  if (!parts.length) return null
  history.replaceState(null, '', loc.pathname + loc.hash)
  const text = parts.join('\n')
  try {
    sessionStorage.setItem(INCOMING_KEY, text)
  } catch {
    /* ignore */
  }
  return text
}

export function takeIncoming() {
  try {
    const t = sessionStorage.getItem(INCOMING_KEY)
    sessionStorage.removeItem(INCOMING_KEY)
    return t
  } catch {
    return null
  }
}
