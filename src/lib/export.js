// Files for any editor (CapCut, Premiere, DaVinci, Final Cut, KinCut) and
// full project backups.

import { Zip, ZipPassThrough, unzipSync, strToU8, strFromU8 } from 'fflate'
import { prompterLines, sceneSeconds, fmtTime, SHOT_SIZES, ANGLES, MOVES, takeCues, uid } from './model.js'
import { getMedia, putMedia, saveProject } from './db.js'
import { extFor } from './recorder.js'
import { editList } from './kincut.js'

const pad = (n) => String(n).padStart(2, '0')

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms % 1000).padStart(3, '0')}`
}

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n')
}

export const clipName = (index, scene, take) =>
  `${pad(index + 1)}_${(scene.title || 'scene').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)}_take${take.n}.${extFor(take.mime)}`

/** Subtitles for the whole edit, assuming clips are laid back to back. */
export function timelineSrt(project) {
  let t = 0
  const cues = []
  for (const { scene, take } of editList(project)) {
    if (scene.kind === 'talk') for (const c of takeCues(scene, take)) cues.push({ ...c, start: c.start + t, end: c.end + t })
    t += take.duration
  }
  return toSrt(cues)
}

export function shootingScript(project, wpm) {
  const out = [`# ${project.name}`, '']
  if (project.topic) out.push(`หัวข้อ: ${project.topic}`)
  out.push(`แพลตฟอร์ม: ${project.platform} · ${project.aspect} · เป้าหมาย ${project.targetSeconds} วินาที`, '')
  project.scenes.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}  (${s.kind === 'broll' ? 'B-roll' : 'พูด'} · ~${fmtTime(sceneSeconds(s, wpm))})`)
    out.push(
      `ช็อต: ${SHOT_SIZES[s.shot.size] ?? s.shot.size} · ${ANGLES[s.shot.angle] ?? s.shot.angle} · ${MOVES[s.shot.move] ?? s.shot.move} · กล้อง${s.shot.camera === 'back' ? 'หลัง' : 'หน้า'}`,
    )
    if (s.direction) out.push(`กำกับ: ${s.direction}`)
    for (const l of prompterLines(s.lines)) out.push(`> ${l}`)
    out.push('')
  })
  if (project.caption) out.push('## แคปชัน', project.caption, '')
  if (project.editNotes?.length) out.push('## โน้ตสำหรับตัดต่อ', ...project.editNotes.map((n) => `- ${n}`), '')
  return out.join('\n')
}

/** Stream entries into a store-only ZIP (videos are already compressed). */
async function zipBlob(entries, onProgress) {
  const parts = []
  let fail
  const zip = new Zip((err, chunk) => (err ? (fail = err) : parts.push(chunk)))
  for (const [i, e] of entries.entries()) {
    onProgress?.({ done: i / entries.length, label: e.name })
    const f = new ZipPassThrough(e.name)
    zip.add(f)
    if (typeof e.data === 'string') f.push(strToU8(e.data), true)
    else {
      const reader = e.data.stream().getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        f.push(value)
        if (fail) throw fail
      }
      f.push(new Uint8Array(0), true)
    }
  }
  zip.end()
  if (fail) throw fail
  onProgress?.({ done: 1, label: 'เสร็จแล้ว' })
  return new Blob(parts, { type: 'application/zip' })
}

/** Files for the editor: best take per scene in order + subtitles + script. */
export async function editorFiles(project, wpm) {
  const files = []
  for (const { scene, index, take } of editList(project)) {
    const blob = await getMedia(take.id)
    if (!blob) continue
    files.push({ name: clipName(index, scene, take), data: blob })
    if (scene.kind === 'talk') {
      const srt = toSrt(takeCues(scene, take))
      if (srt) files.push({ name: clipName(index, scene, take).replace(/\.\w+$/, '.srt'), data: srt })
    }
  }
  files.push({ name: '00_บทถ่ายทำ.md', data: shootingScript(project, wpm) })
  const all = timelineSrt(project)
  if (all) files.push({ name: '00_ซับทั้งคลิป.srt', data: all })
  return files
}

export const editorZip = async (project, wpm, onProgress) => zipBlob(await editorFiles(project, wpm), onProgress)

/** Complete backup: project JSON + every take (also rejected ones). */
export async function backupZip(project, onProgress) {
  const entries = [{ name: 'kinshot-project.json', data: JSON.stringify(project, null, 2) }]
  for (const t of project.takes) {
    const blob = await getMedia(t.id)
    if (blob) entries.push({ name: `media/${t.id}.${extFor(t.mime)}`, data: blob })
  }
  return zipBlob(entries, onProgress)
}

/** Restore a backup as a new project (fresh ids so it never overwrites). */
export async function restoreBackup(file) {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const json = files['kinshot-project.json']
  if (!json) throw new Error('ไฟล์นี้ไม่ใช่แบ็กอัป KinShot')
  const p = JSON.parse(strFromU8(json))
  if (p?.version !== 1 || !Array.isArray(p.scenes) || !Array.isArray(p.takes)) throw new Error('แบ็กอัปเสียหายหรือเวอร์ชันไม่รองรับ')
  const takes = []
  for (const t of p.takes) {
    const data = files[`media/${t.id}.${extFor(t.mime)}`]
    if (!data) continue
    const id = uid()
    await putMedia(id, new Blob([data], { type: t.mime }))
    takes.push({ ...t, id })
  }
  const restored = { ...p, id: uid(), name: `${p.name} (กู้คืน)`, takes, updatedAt: Date.now() }
  await saveProject(restored)
  return restored
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Share sheet with files (iOS/Android: save to Photos, AirDrop, Drive, CapCut…). */
export async function shareFiles(files, title) {
  const list = files.map((f) =>
    f.data instanceof Blob ? new File([f.data], f.name, { type: f.data.type }) : new File([f.data], f.name, { type: 'text/plain' }),
  )
  if (!navigator.canShare?.({ files: list })) return false
  await navigator.share({ files: list, title })
  return true
}

export const canSaveToFolder = () => typeof window.showDirectoryPicker === 'function'

/** Desktop Chrome/Edge: write everything into a folder the user picks. */
export async function saveToFolder(files, folderName, onProgress) {
  const parent = await window.showDirectoryPicker({ mode: 'readwrite' })
  const dir = await parent.getDirectoryHandle(folderName.replace(/[\\/:*?"<>|]+/g, '-'), { create: true })
  for (const [i, f] of files.entries()) {
    onProgress?.({ done: i / files.length, label: f.name })
    const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable()
    await w.write(f.data)
    await w.close()
  }
  onProgress?.({ done: 1, label: 'เสร็จแล้ว' })
}
