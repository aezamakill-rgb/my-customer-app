// Turn an AI answer (API or pasted) into the next project state.

import { normalizeScenes } from '../model.js'
import { extractJson } from './parse.js'
import { isOwnPrompt } from './prompts.js'

export const STEPS = ['oneshot', 'research', 'write', 'direct']

/**
 * @param role 'oneshot' | 'research' | 'write' | 'direct'
 * @throws when the text holds no usable answer
 */
export function applyAiResult(project, role, text, meta = {}) {
  const t = String(text ?? '').trim()
  if (!t) throw new Error('ยังไม่มีคำตอบ — คัดลอกคำตอบจากแอป AI ก่อน')
  if (isOwnPrompt(t)) throw new Error('ในคลิปบอร์ดยังเป็น prompt อยู่ — คัดลอก “คำตอบ” ของ AI แล้วลองใหม่')
  const ai = { ...project.ai, [role]: { text: t, by: meta.by, model: meta.model, sources: meta.sources, at: Date.now() } }
  if (role === 'research') return { ...project, research: t, ai }
  const json = extractJson(t)
  const scenes = normalizeScenes(json)
  if (!scenes.length) throw new Error('อ่านบทจากคำตอบไม่ได้ — ต้องเป็น JSON ที่มี "scenes" (คัดลอกคำตอบทั้งหมดอีกครั้ง)')
  return {
    ...project,
    ai,
    scenes,
    research: role === 'oneshot' && typeof json.research === 'string' && json.research.trim() ? json.research.trim() : project.research,
    name: project.name === 'คอนเทนต์ใหม่' && json.title ? String(json.title).slice(0, 80) : project.name,
    hookOptions: Array.isArray(json.hook_options) ? json.hook_options.map(String) : project.hookOptions,
    caption: typeof json.caption === 'string' ? json.caption : project.caption,
    hashtags: Array.isArray(json.hashtags) ? json.hashtags.map(String) : project.hashtags,
    editNotes: Array.isArray(json.notes) ? json.notes.map(String) : project.editNotes,
  }
}

/** Does this answer replace the scene list (and so orphan existing takes)? */
export const replacesScenes = (role) => role !== 'research'
