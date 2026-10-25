// Hand the finished shoot to KinCut as a ready-to-edit project.
//
// KinCut keeps projects in the Origin Private File System:
//   projects/<id>.json        — project (version 1)
//   media/<assetId>/<file>    — source media
// Browsers share OPFS per origin, so when KinShot is served from the same
// origin as KinCut (both on aezamakill-rgb.github.io) we can write the
// project straight into KinCut's storage. Elsewhere we fall back to files.

import { uid, bestTake, takeCues } from './model.js'
import { getMedia } from './db.js'
import { probeMedia, extFor } from './recorder.js'

const KINCUT_ASPECTS = new Set(['9:16', '1:1', '4:5', '16:9'])
export const SUBTITLE_STYLE = 'sub_vlog'

export function kincutOrigin(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Can we write directly into KinCut's storage from this page? */
export function canHandoff(kincutUrl) {
  return (
    kincutOrigin(kincutUrl) === location.origin &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  )
}

const safeName = (s) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'media'

/** Ordered list of the takes that go into the edit (best take per scene). */
export function editList(project) {
  return project.scenes
    .map((scene, i) => ({ scene, index: i, take: bestTake(project, scene.id) }))
    .filter((x) => x.take)
}

/**
 * Build the KinCut project JSON. Pure function (tested) — `media` gives each
 * take's probed metadata and file name.
 */
export function buildKincutProject(project, items, media, { subtitles = true, now = Date.now() } = {}) {
  const assets = []
  const clips = []
  const texts = []
  let t = 0
  for (const { scene, take } of items) {
    const m = media[take.id]
    const assetId = uid()
    const duration = m.duration > 0 ? m.duration : take.duration
    assets.push({
      id: assetId,
      kind: 'video',
      name: m.fileName,
      opfsPath: `media/${assetId}/${m.fileName}`,
      mime: take.mime,
      size: m.size,
      duration,
      hasAudio: m.hasAudio ?? true,
      ...(m.width && { width: m.width, height: m.height }),
    })
    clips.push({ id: uid(), assetId, in: 0, out: duration, speed: 1, volume: 1, fit: 'cover' })
    if (subtitles && scene.kind === 'talk') {
      for (const cue of takeCues(scene, { ...take, duration })) {
        // "asr-" prefix: KinCut replaces these drafts if you run its auto-subtitles.
        texts.push({
          id: `asr-${uid()}`,
          text: cue.text,
          start: t + cue.start,
          end: t + cue.end,
          styleId: SUBTITLE_STYLE,
          x: 0.5,
          y: 0.82,
          scale: 1,
          kind: 'subtitle',
        })
      }
    }
    t += duration
  }
  return {
    version: 1,
    id: uid(),
    name: project.name,
    aspect: KINCUT_ASPECTS.has(project.aspect) ? project.aspect : '9:16',
    fps: 30,
    createdAt: now,
    updatedAt: now,
    assets,
    clips,
    texts,
    stickers: [],
  }
}

/** Write the shoot into KinCut's OPFS. Returns the new KinCut project id. */
export async function sendToKincut(project, { subtitles = true, onProgress = () => {} } = {}) {
  const items = editList(project)
  if (!items.length) throw new Error('ยังไม่มีเทคที่ใช้ได้ ถ่ายและเลือกเทคก่อน')
  const root = await navigator.storage.getDirectory()
  const mediaDir = await root.getDirectoryHandle('media', { create: true })
  const projectsDir = await root.getDirectoryHandle('projects', { create: true })
  const media = {}
  const blobs = {}
  for (const [n, { take, index }] of items.entries()) {
    onProgress({ done: n / items.length, label: `เตรียมไฟล์ ${n + 1}/${items.length}` })
    const blob = await getMedia(take.id)
    if (!blob) throw new Error(`ไม่พบไฟล์วิดีโอของฉาก ${index + 1}`)
    const info = await probeMedia(blob).catch(() => ({}))
    blobs[take.id] = blob
    media[take.id] = {
      ...info,
      size: blob.size,
      fileName: safeName(`kinshot-${String(index + 1).padStart(2, '0')}-take${take.n}.${extFor(take.mime)}`),
    }
  }
  const kc = buildKincutProject(project, items, media, { subtitles })
  const written = []
  try {
    for (const [n, asset] of kc.assets.entries()) {
      onProgress({ done: n / kc.assets.length, label: `คัดลอกเข้า KinCut ${n + 1}/${kc.assets.length}` })
      const dir = await mediaDir.getDirectoryHandle(asset.id, { create: true })
      written.push(asset.id)
      const fh = await dir.getFileHandle(asset.name, { create: true })
      await blobs[items[n].take.id].stream().pipeTo(await fh.createWritable())
    }
    const fh = await projectsDir.getFileHandle(`${kc.id}.json`, { create: true })
    const w = await fh.createWritable()
    await w.write(JSON.stringify(kc))
    await w.close()
  } catch (e) {
    for (const id of written) await mediaDir.removeEntry(id, { recursive: true }).catch(() => {})
    if (e?.name === 'QuotaExceededError') throw new Error('พื้นที่เก็บข้อมูลไม่พอ ลบโปรเจคเก่าหรือเทคที่ไม่ใช้ก่อน')
    throw e
  }
  onProgress({ done: 1, label: 'เสร็จแล้ว' })
  return kc.id
}
