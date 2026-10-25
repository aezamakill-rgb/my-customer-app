// Shoot project data model. Everything here is plain JSON so it can be
// stored in IndexedDB, exported as a backup and handed to AI models.

export const ASPECTS = ['9:16', '16:9', '1:1', '4:5']

export const PLATFORMS = [
  { id: 'tiktok', name: 'TikTok', aspect: '9:16', seconds: 45 },
  { id: 'reels', name: 'Instagram Reels', aspect: '9:16', seconds: 30 },
  { id: 'shorts', name: 'YouTube Shorts', aspect: '9:16', seconds: 50 },
  { id: 'youtube', name: 'YouTube (แนวนอน)', aspect: '16:9', seconds: 300 },
  { id: 'facebook', name: 'Facebook', aspect: '4:5', seconds: 60 },
]

export const SHOT_SIZES = {
  ECU: 'Extreme close-up (เฉพาะจุด)',
  CU: 'Close-up (หน้า/ของชัด)',
  MCU: 'Medium close-up (อก-หัว)',
  MS: 'Medium shot (เอว-หัว)',
  WS: 'Wide shot (เห็นทั้งตัว/บรรยากาศ)',
  POV: 'POV (มุมสายตาคนถือ)',
  OTS: 'Over the shoulder (ข้ามไหล่)',
  TOP: 'Top-down (มุมบนลงล่าง)',
}

export const ANGLES = {
  eye: 'ระดับสายตา',
  high: 'มุมสูง (กดลง)',
  low: 'มุมต่ำ (เงยขึ้น)',
  dutch: 'มุมเอียง',
}

export const MOVES = {
  static: 'นิ่ง (ตั้งขาตั้ง)',
  pushin: 'ดันเข้าช้าๆ (push-in)',
  pullout: 'ถอยออกช้าๆ (pull-out)',
  pan: 'แพนซ้าย-ขวา',
  tilt: 'ทิลต์ขึ้น-ลง',
  follow: 'ถือเดินตาม',
  orbit: 'วนรอบวัตถุ',
  handheld: 'ถือมือ (มีชีวิต)',
}

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function newScene(partial = {}) {
  return {
    id: uid(),
    title: 'ฉากใหม่',
    kind: 'talk', // talk = มีบทพูด, broll = ภาพประกอบไม่มีบท
    lines: '',
    shot: { size: 'MCU', angle: 'eye', move: 'static', camera: 'front' },
    direction: '',
    seconds: 0, // 0 = estimate from lines
    ...partial,
  }
}

export function newProject(partial = {}) {
  const now = Date.now()
  return {
    version: 1,
    id: uid(),
    name: 'คอนเทนต์ใหม่',
    platform: 'tiktok',
    aspect: '9:16',
    targetSeconds: 45,
    topic: '',
    audience: '',
    tone: 'เป็นกันเอง สนุก',
    goal: '',
    research: '',
    notes: '',
    scenes: [],
    takes: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

export const touch = (project, patch) => ({ ...project, ...patch, updatedAt: Date.now() })

// ---------- speech timing ----------

const thaiRe = /[฀-๿]/

let segmenter
function words(text) {
  if (!text.trim()) return []
  try {
    segmenter ??= new Intl.Segmenter('th', { granularity: 'word' })
    return [...segmenter.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment)
  } catch {
    // Older engines: Thai has no spaces, approximate one word per 4 chars.
    return text
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((w) => (thaiRe.test(w) ? Array(Math.max(1, Math.round(w.length / 4))).fill(w) : [w]))
  }
}

/** Seconds needed to say `text` at `wpm` words per minute (Thai ~170 wpm natural). */
export function speakSeconds(text, wpm = 170) {
  const n = words(text).length
  if (!n) return 0
  const pauses = (text.match(/[.!?…\n,]|ๆ /g) ?? []).length * 0.25
  return n / (wpm / 60) + pauses
}

/** Split scene text into prompter lines (one breath each). */
export function prompterLines(text) {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
}

export function sceneSeconds(scene, wpm) {
  if (scene.seconds > 0) return scene.seconds
  const s = speakSeconds(scene.lines, wpm)
  return scene.kind === 'broll' ? Math.max(3, s) : Math.max(2, Math.round(s * 10) / 10)
}

export function totalSeconds(project, wpm) {
  return project.scenes.reduce((sum, s) => sum + sceneSeconds(s, wpm), 0)
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '--:--'
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------- takes ----------

/** Best take for a scene: starred > marked good > latest not rejected. */
export function bestTake(project, sceneId) {
  const takes = project.takes.filter((t) => t.sceneId === sceneId)
  return (
    takes.find((t) => t.best) ??
    [...takes].reverse().find((t) => t.rating === 'good') ??
    [...takes].reverse().find((t) => t.rating !== 'bad') ??
    null
  )
}

export function sceneStatus(project, scene) {
  const takes = project.takes.filter((t) => t.sceneId === scene.id)
  if (takes.some((t) => t.best || t.rating === 'good')) return 'done'
  if (takes.some((t) => t.rating !== 'bad')) return 'review'
  return takes.length ? 'retake' : 'todo'
}

export function progress(project) {
  const done = project.scenes.filter((s) => sceneStatus(project, s) === 'done').length
  return { done, total: project.scenes.length }
}

/**
 * Subtitle cues for a take from the prompter timeline: each line shows
 * from the moment it became active until the next line (or take end).
 */
export function takeCues(scene, take) {
  const lines = prompterLines(scene.lines)
  const marks = (take.cues ?? []).filter((c) => c.line < lines.length).sort((a, b) => a.t - b.t)
  const out = []
  for (let i = 0; i < marks.length; i++) {
    const start = Math.max(0, marks[i].t)
    const end = Math.min(take.duration, marks[i + 1]?.t ?? take.duration)
    if (end - start >= 0.3) out.push({ text: lines[marks[i].line], start, end })
  }
  return out
}

/** Normalize anything an AI returned into a valid scene list. */
export function normalizeScenes(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.scenes) ? raw.scenes : []
  return list
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => {
      const shot = s.shot ?? {}
      const pick = (v, table, def) => (typeof v === 'string' && v in table ? v : def)
      const lines = Array.isArray(s.lines) ? s.lines.join('\n') : String(s.lines ?? s.script ?? '')
      const kind = s.kind === 'broll' || (!lines.trim() && s.kind !== 'talk') ? 'broll' : 'talk'
      return newScene({
        title: String(s.title ?? `ฉาก ${i + 1}`).slice(0, 80),
        kind,
        lines: lines.trim(),
        shot: {
          size: pick(String(shot.size ?? '').toUpperCase(), SHOT_SIZES, kind === 'broll' ? 'CU' : 'MCU'),
          angle: pick(shot.angle, ANGLES, 'eye'),
          move: pick(shot.move, MOVES, 'static'),
          camera: shot.camera === 'back' || shot.camera === 'front' ? shot.camera : kind === 'broll' ? 'back' : 'front',
        },
        direction: String(s.direction ?? s.notes ?? '').trim(),
        seconds: Number.isFinite(+s.seconds) && +s.seconds > 0 ? Math.min(600, +s.seconds) : 0,
      })
    })
}
