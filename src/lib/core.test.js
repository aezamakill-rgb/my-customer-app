import { describe, it, expect } from 'vitest'
import { speakSeconds, prompterLines, normalizeScenes, newProject, newScene, takeCues, bestTake, sceneStatus, progress } from './model.js'
import { extractJson } from './ai/parse.js'
import { lineCoverage } from './follow.js'
import { buildKincutProject, editList, SUBTITLE_STYLE } from './kincut.js'
import { toSrt, clipName, timelineSrt, shootingScript } from './export.js'
import { chooseOpenAIModel, chooseGeminiModel, providerFor } from './ai/providers.js'
import { writePrompt, researchPrompt, directPrompt, scriptToJson } from './ai/prompts.js'
import { TEMPLATES } from './templates.js'

describe('speech timing', () => {
  it('estimates Thai speaking time from word count', () => {
    const s = speakSeconds('วันนี้จะมารีวิวกล้องมือถือที่ถ่ายวิดีโอสวยที่สุดในงบหนึ่งหมื่นบาท', 170)
    expect(s).toBeGreaterThan(2)
    expect(s).toBeLessThan(8)
    expect(speakSeconds('', 170)).toBe(0)
  })
  it('splits prompter lines on new lines and drops blanks', () => {
    expect(prompterLines('a\n\n b \n')).toEqual(['a', 'b'])
  })
})

describe('AI output parsing', () => {
  const script = {
    title: 'รีวิว',
    scenes: [
      { title: 'Hook', kind: 'talk', lines: ['หยุดก่อน!', 'ดูนี่'], shot: { size: 'cu', angle: 'low', move: 'pushin', camera: 'front' }, direction: 'ยิ้ม', seconds: 3 },
      { title: 'B-roll', kind: 'broll', lines: [], shot: { size: 'XYZ', camera: 'back' } },
    ],
  }
  it('reads JSON from fences, preambles and trailing commas', () => {
    expect(extractJson('นี่คือบทครับ\n```json\n' + JSON.stringify(script) + '\n```')).toEqual(script)
    expect(extractJson('ok ' + JSON.stringify(script) + ' จบ')).toEqual(script)
    expect(extractJson('{"title":"a","scenes":[{"title":"x",},],}')?.scenes).toHaveLength(1)
    expect(extractJson('ไม่มี json')).toBeUndefined()
  })
  it('normalizes scenes and repairs unknown values', () => {
    const scenes = normalizeScenes(script)
    expect(scenes).toHaveLength(2)
    expect(scenes[0]).toMatchObject({ kind: 'talk', lines: 'หยุดก่อน!\nดูนี่', seconds: 3, shot: { size: 'CU', angle: 'low', move: 'pushin', camera: 'front' } })
    expect(scenes[1]).toMatchObject({ kind: 'broll', shot: { size: 'CU', angle: 'eye', move: 'static', camera: 'back' } })
    expect(scenes[0].id).not.toBe(scenes[1].id)
    expect(normalizeScenes(null)).toEqual([])
  })
})

describe('voice follow matching', () => {
  it('scores how much of a line has been heard', () => {
    const line = 'วันนี้จะมารีวิวกล้องมือถือ'
    expect(lineCoverage('วันนี้จะมารีวิวกล้องมือถือ', line)).toBe(1)
    expect(lineCoverage('วันนี้จะมา รีวิว กล้อง มือถือ ครับ', line)).toBeGreaterThan(0.9)
    expect(lineCoverage('วันนี้จะมา', line)).toBeLessThan(0.5)
    expect(lineCoverage('สวัสดีครับ', line)).toBeLessThan(0.2)
  })
})

function shotProject() {
  const a = newScene({ title: 'Hook', lines: 'บรรทัดแรก\nบรรทัดสอง' })
  const b = newScene({ title: 'B-roll', kind: 'broll' })
  const c = newScene({ title: 'CTA', lines: 'กดติดตาม' })
  const take = (scene, n, extra) => ({ id: `t-${scene.title}-${n}`, sceneId: scene.id, n, mime: 'video/mp4', duration: 4, cues: [], rating: null, best: false, ...extra })
  return newProject({
    name: 'ทดสอบ',
    aspect: '9:16',
    scenes: [a, b, c],
    takes: [
      take(a, 1, { rating: 'bad' }),
      take(a, 2, { rating: 'good', cues: [{ line: 0, t: 0.2 }, { line: 1, t: 2.1 }] }),
      take(b, 1, { duration: 3 }),
    ],
  })
}

describe('takes', () => {
  it('picks the best take per scene and tracks progress', () => {
    const p = shotProject()
    expect(bestTake(p, p.scenes[0].id).n).toBe(2)
    expect(bestTake(p, p.scenes[2].id)).toBeNull()
    expect(sceneStatus(p, p.scenes[0])).toBe('done')
    expect(sceneStatus(p, p.scenes[1])).toBe('review')
    expect(sceneStatus(p, p.scenes[2])).toBe('todo')
    expect(progress(p)).toEqual({ done: 1, total: 3 })
    expect(editList(p).map((x) => x.index)).toEqual([0, 1])
  })
  it('turns prompter timing into subtitle cues', () => {
    const p = shotProject()
    const cues = takeCues(p.scenes[0], p.takes[1])
    expect(cues).toEqual([
      { text: 'บรรทัดแรก', start: 0.2, end: 2.1 },
      { text: 'บรรทัดสอง', start: 2.1, end: 4 },
    ])
  })
})

describe('KinCut handoff', () => {
  it('builds a KinCut v1 project with sequential clips and timeline subtitles', () => {
    const p = shotProject()
    const items = editList(p)
    const media = {
      [items[0].take.id]: { duration: 4.2, width: 1080, height: 1920, hasAudio: true, size: 100, fileName: 'kinshot-01-take2.mp4' },
      [items[1].take.id]: { duration: 3, width: 1080, height: 1920, hasAudio: true, size: 50, fileName: 'kinshot-02-take1.mp4' },
    }
    const kc = buildKincutProject(p, items, media, { now: 1 })
    expect(kc).toMatchObject({ version: 1, name: 'ทดสอบ', aspect: '9:16', fps: 30, createdAt: 1, updatedAt: 1, stickers: [] })
    expect(kc.assets).toHaveLength(2)
    expect(kc.assets[0]).toMatchObject({ kind: 'video', mime: 'video/mp4', duration: 4.2, width: 1080, height: 1920, size: 100 })
    expect(kc.assets[0].opfsPath).toBe(`media/${kc.assets[0].id}/kinshot-01-take2.mp4`)
    expect(kc.assets[0].opfsPath.split('/')).toHaveLength(3)
    expect(kc.clips.map((c) => [c.assetId, c.in, c.out, c.speed, c.fit])).toEqual([
      [kc.assets[0].id, 0, 4.2, 1, 'cover'],
      [kc.assets[1].id, 0, 3, 1, 'cover'],
    ])
    expect(kc.texts.map((t) => [t.text, t.start, t.end, t.styleId, t.kind])).toEqual([
      ['บรรทัดแรก', 0.2, 2.1, SUBTITLE_STYLE, 'subtitle'],
      ['บรรทัดสอง', 2.1, 4.2, SUBTITLE_STYLE, 'subtitle'],
    ])
    expect(kc.texts.every((t) => t.id.startsWith('asr-'))).toBe(true)
    expect(buildKincutProject(p, items, media, { subtitles: false }).texts).toEqual([])
  })
})

describe('export', () => {
  it('writes SRT', () => {
    expect(toSrt([{ text: 'สวัสดี', start: 1.5, end: 62.25 }])).toBe('1\n00:00:01,500 --> 00:01:02,250\nสวัสดี\n')
  })
  it('names clips in scene order and builds a whole-edit SRT', () => {
    const p = shotProject()
    expect(clipName(0, p.scenes[0], p.takes[1])).toBe('01_Hook_take2.mp4')
    expect(timelineSrt(p)).toContain('00:00:02,100 --> 00:00:04,000')
    expect(shootingScript(p, 170)).toContain('> บรรทัดแรก')
  })
})

describe('AI team', () => {
  it('auto-picks the newest general model', () => {
    expect(chooseOpenAIModel(['gpt-4o', 'gpt-5.6-sol', 'gpt-5.6-mini', 'gpt-5.2', 'gpt-realtime', 'gpt-5.6-sol-2026-07-09', 'dall-e-3'])).toBe('gpt-5.6-sol')
    expect(
      chooseGeminiModel([
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.7-flash-image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ]),
    ).toBe('gemini-3.7-flash')
  })
  it('falls back to any provider with a key', () => {
    const s = { keys: { claude: '', openai: 'k', gemini: '' }, roles: { research: 'gemini', write: 'claude', direct: 'openai' } }
    expect(providerFor('research', s)).toBe('openai')
    expect(providerFor('direct', s)).toBe('openai')
    expect(providerFor('write', { ...s, keys: { claude: '', openai: '', gemini: '' } })).toBeNull()
  })
  it('includes the brief and research in prompts', () => {
    const p = newProject({ topic: 'กล้องมือถือ', targetSeconds: 40, research: 'ข้อมูลวิจัย', scenes: TEMPLATES[0].build('กล้อง') })
    expect(researchPrompt(p).user).toContain('กล้องมือถือ')
    expect(writePrompt(p, p.research).user).toContain('ข้อมูลวิจัย')
    expect(writePrompt(p).user).toContain('40 วินาที')
    const json = scriptToJson(p)
    expect(JSON.parse(json).scenes).toHaveLength(p.scenes.length)
    expect(directPrompt(p, json).user).toContain(json)
  })
})

describe('fewer app switches', async () => {
  const { applyAiResult } = await import('./ai/apply.js')
  const { teamPrompt, isOwnPrompt, asPaste } = await import('./ai/prompts.js')
  const answer = JSON.stringify({
    title: 'บทใหม่',
    research: 'สรุป: คนชอบหูฟังราคาถูก (แหล่ง: example.com)',
    hook_options: ['h1'],
    scenes: [{ title: 'Hook', kind: 'talk', lines: ['บรรทัด'], shot: { size: 'CU', camera: 'front' } }],
    caption: 'cap',
    hashtags: ['#a'],
    notes: ['n'],
  })

  it('one-shot prompt runs all three roles and asks for research in the JSON', () => {
    const p = newProject({ topic: 'หูฟัง', targetSeconds: 30 })
    const text = asPaste(teamPrompt(p))
    expect(text).toContain('นักรีเสิร์ช')
    expect(text).toContain('ผู้กำกับ')
    expect(text).toContain('"research": "สรุปผลรีเสิร์ช')
    expect(text).toContain('30 วินาที')
    expect(isOwnPrompt(text)).toBe(true)
  })

  it('applies a one-shot answer: scenes, research, caption, title', () => {
    const p = applyAiResult(newProject(), 'oneshot', 'นี่ครับ\n' + answer, { by: 'gemini' })
    expect(p.scenes).toHaveLength(1)
    expect(p.research).toContain('หูฟังราคาถูก')
    expect(p.name).toBe('บทใหม่')
    expect(p.caption).toBe('cap')
    expect(p.ai.oneshot.by).toBe('gemini')
  })

  it('rejects the prompt itself or an empty clipboard', () => {
    const p = newProject({ topic: 'x' })
    expect(() => applyAiResult(p, 'oneshot', asPaste(teamPrompt(p)))).toThrow(/prompt/)
    expect(() => applyAiResult(p, 'write', '   ')).toThrow(/คำตอบ/)
    expect(() => applyAiResult(p, 'write', 'ข้อความทั่วไป')).toThrow(/JSON/)
    expect(applyAiResult(p, 'research', 'ผลรีเสิร์ช').research).toBe('ผลรีเสิร์ช')
  })
})
