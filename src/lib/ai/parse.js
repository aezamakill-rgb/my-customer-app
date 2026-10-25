// Pull the JSON object out of whatever an AI (or a copy/paste) returned:
// code fences, chatty preambles, trailing commas, smart quotes.

function balancedObject(text, from) {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(from, i + 1)
  }
  return null
}

function tryParse(s) {
  for (const candidate of [
    s,
    s.replace(/,\s*([}\]])/g, '$1'),
    s.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1'),
  ]) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* try next repair */
    }
  }
  return undefined
}

export function extractJson(text) {
  if (typeof text !== 'string') return undefined
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1])
  for (const f of fences) {
    const v = tryParse(f.trim())
    if (v && typeof v === 'object') return v
  }
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    const obj = balancedObject(text, i)
    if (!obj) break
    const v = tryParse(obj)
    if (v && typeof v === 'object' && (v.scenes || v.title)) return v
  }
  return undefined
}
