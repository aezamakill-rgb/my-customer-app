// Voice-follow teleprompter: listen with the browser's speech recognition
// and move to the next line once most of the current line has been said.
// Thai has no spaces, so matching works on character bigrams, which is
// tolerant of recognition mistakes and missing words.

const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

function bigrams(s) {
  const out = new Map()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Share of `line`'s bigrams that appear in `heard` (0..1). */
export function lineCoverage(heard, line) {
  const a = norm(line)
  const b = norm(heard)
  if (a.length < 2) return b.length ? 1 : 0
  const want = bigrams(a)
  const got = bigrams(b)
  let hit = 0
  let total = 0
  for (const [g, n] of want) {
    total += n
    hit += Math.min(n, got.get(g) ?? 0)
  }
  return hit / total
}

export const speechSupported = () => !!(globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition)

/**
 * Start listening. `onAdvance()` fires each time the current line is
 * considered spoken. Returns `{ stop, reset }`.
 */
export function followVoice({ getLine, onAdvance, onHeard, lang = 'th-TH', threshold = 0.6 }) {
  const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition
  if (!SR) return null
  let stopped = false
  let heard = '' // text heard since the current line started
  let finalized = ''
  const rec = new SR()
  rec.lang = lang
  rec.continuous = true
  rec.interimResults = true
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalized += r[0].transcript
      else interim += r[0].transcript
    }
    heard = finalized + interim
    onHeard?.(heard)
    const line = getLine()
    if (line && lineCoverage(heard.slice(-Math.max(40, line.length * 2)), line) >= threshold) {
      finalized = ''
      heard = ''
      onAdvance()
    }
  }
  // Recognition stops by itself after silence on most browsers: restart.
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start()
      } catch {
        /* already starting */
      }
    }
  }
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true
  }
  rec.start()
  return {
    stop() {
      stopped = true
      try {
        rec.abort()
      } catch {
        /* ignore */
      }
    },
    reset() {
      heard = ''
      finalized = ''
    },
  }
}
