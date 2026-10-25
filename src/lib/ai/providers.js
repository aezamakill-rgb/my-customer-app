// Direct browser calls with the user's own API keys. Keys never leave the
// device except to the provider they belong to.

const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

async function claude({ key, model, system, user, research, signal }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
  const params = {
    model: model || 'claude-opus-5-5',
    max_tokens: 32000,
    output_config: { effort: 'medium' },
    system,
    messages: [{ role: 'user', content: user }],
    ...(research && { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }] }),
    // On a safety decline the API retries on a suitable model in the same call.
    ...(FALLBACK_MODELS.has(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
  }
  let message
  for (let turn = 0; turn < 4; turn++) {
    message = await client.beta.messages.stream(params, { signal }).finalMessage()
    if (message.stop_reason !== 'pause_turn') break
    // Long server-side web search: hand the partial turn back so it continues.
    params.messages = [...params.messages, { role: 'assistant', content: message.content }]
  }
  if (message.stop_reason === 'refusal') throw new Error('Claude ปฏิเสธคำขอนี้ ลองปรับหัวข้อหรือรายละเอียด')
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const sources = message.content
    .filter((b) => b.type === 'web_search_tool_result' && Array.isArray(b.content))
    .flatMap((b) => b.content.map((r) => ({ title: r.title, url: r.url })))
  return { text, sources, model: message.model }
}

async function openai({ key, model, system, user, json, signal }) {
  model ||= await pickOpenAIModel(key, signal)
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(json && { response_format: { type: 'json_object' } }),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`ChatGPT: ${data.error?.message ?? `HTTP ${res.status}`}`)
  return { text: data.choices?.[0]?.message?.content ?? '', sources: [], model: data.model ?? model }
}

async function gemini({ key, model, system, user, json, research, signal }) {
  model ||= await pickGeminiModel(key, signal)
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        // Grounding with Google Search for the research role.
        ...(research && { tools: [{ google_search: {} }] }),
        ...(json && !research && { generationConfig: { responseMimeType: 'application/json' } }),
      }),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gemini: ${data.error?.message ?? `HTTP ${res.status}`}`)
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => c.web)
    .filter(Boolean)
    .map((w) => ({ title: w.title, url: w.uri }))
  if (!text) throw new Error(`Gemini ไม่ได้ส่งข้อความกลับ (${cand?.finishReason ?? 'unknown'})`)
  return { text, sources, model }
}

// ---------- model discovery: pick the newest general model automatically ----------

const version = (id) => (id.match(/(\d+(?:\.\d+)?)/)?.[1] ?? '0').split('.').map(Number)
const cmpVersion = (a, b) => {
  const [x, y] = [version(a), version(b)]
  return (y[0] ?? 0) - (x[0] ?? 0) || (y[1] ?? 0) - (x[1] ?? 0)
}

export function chooseOpenAIModel(ids) {
  const chat = ids.filter((id) => /^gpt-\d/.test(id) && !/(audio|realtime|image|tts|transcribe|search|nano|mini|codex|oss)/.test(id))
  const plain = chat.filter((id) => !/-\d{4}-\d{2}-\d{2}$/.test(id))
  return (plain.length ? plain : chat).sort((a, b) => cmpVersion(a, b) || a.length - b.length)[0]
}

export function chooseGeminiModel(models) {
  const ok = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((id) => /^gemini-\d/.test(id) && !/(image|tts|audio|live|embedding|lite|robotics|computer)/.test(id))
  const rank = (id) => (/-pro/.test(id) ? 0 : 1)
  return ok.sort((a, b) => cmpVersion(a, b) || rank(a) - rank(b) || a.length - b.length)[0]
}

const picked = {}

async function pickOpenAIModel(key, signal) {
  if (picked.openai) return picked.openai
  const res = await fetch('https://api.openai.com/v1/models', { signal, headers: { Authorization: `Bearer ${key}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`ChatGPT: ${data.error?.message ?? `HTTP ${res.status}`}`)
  const id = chooseOpenAIModel((data.data ?? []).map((m) => m.id))
  if (!id) throw new Error('ChatGPT: ไม่พบรุ่นที่ใช้ได้ ใส่ชื่อรุ่นเองในตั้งค่า')
  return (picked.openai = id)
}

async function pickGeminiModel(key, signal) {
  if (picked.gemini) return picked.gemini
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    signal,
    headers: { 'x-goog-api-key': key },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gemini: ${data.error?.message ?? `HTTP ${res.status}`}`)
  const id = chooseGeminiModel(data.models ?? [])
  if (!id) throw new Error('Gemini: ไม่พบรุ่นที่ใช้ได้ ใส่ชื่อรุ่นเองในตั้งค่า')
  return (picked.gemini = id)
}

const CALL = { claude, openai, gemini }

/**
 * Run one prompt on a provider.
 * @returns {Promise<{text: string, sources: {title?: string, url: string}[], model: string}>}
 */
export function callProvider(provider, settings, prompt, opts = {}) {
  const key = settings.keys[provider]
  if (!key) throw new Error(`ยังไม่ได้ใส่ API key ของ ${provider}`)
  return CALL[provider]({ key, model: settings.models[provider], ...prompt, ...opts })
}

/** Providers that have a key, in team order. */
export const readyProviders = (settings) => ['claude', 'openai', 'gemini'].filter((p) => settings.keys[p])

/** The provider for a role, falling back to any provider that has a key. */
export function providerFor(role, settings) {
  const want = settings.roles[role]
  if (settings.keys[want]) return want
  return readyProviders(settings)[0] ?? null
}
