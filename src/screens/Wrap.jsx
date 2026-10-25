import { useEffect, useState } from 'react'
import { useProject, useSettings, go } from '../lib/store.js'
import { sceneStatus, bestTake, fmtTime, progress } from '../lib/model.js'
import { getMedia, deleteMedia } from '../lib/db.js'
import { canHandoff, sendToKincut, editList } from '../lib/kincut.js'
import { editorFiles, editorZip, backupZip, download, shareFiles, canSaveToFolder, saveToFolder, shootingScript } from '../lib/export.js'
import { BackButton, Modal, Progress } from '../components/ui.jsx'
import { toast, copyText, fmtBytes } from '../lib/notify.js'

function TakePlayer({ project, take, update, onClose }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let u
    getMedia(take.id).then((b) => b && setUrl((u = URL.createObjectURL(b))))
    return () => u && URL.revokeObjectURL(u)
  }, [take.id])
  const scene = project.scenes.find((s) => s.id === take.sceneId)
  const set = (patch) =>
    update((p) => ({
      ...p,
      takes: p.takes.map((t) => (t.id === take.id ? { ...t, ...patch } : patch.best && t.sceneId === take.sceneId ? { ...t, best: false } : t)),
    }))
  return (
    <Modal onClose={onClose}>
      <strong>
        {scene?.title ?? 'ฉากที่ถูกลบ'} · เทค {take.n} · {fmtTime(take.duration)} · {fmtBytes(take.size ?? 0)}
      </strong>
      {url ? <video src={url} controls autoPlay playsInline /> : <div className="empty">กำลังโหลด…</div>}
      <div className="row">
        <button className={`grow ${take.best ? 'on' : ''}`} onClick={() => set({ best: true, rating: 'good' })}>
          ⭐ เทคที่ใช้
        </button>
        <button className={`grow ${take.rating === 'good' && !take.best ? 'on' : ''}`} onClick={() => set({ rating: 'good', best: false })}>
          ✓ ดี
        </button>
        <button className={`grow ${take.rating === 'bad' ? 'on' : ''}`} onClick={() => set({ rating: 'bad', best: false })}>
          ✗ ไม่ใช้
        </button>
      </div>
      <div className="row">
        {url && (
          <a className="btn grow" href={url} download={`take-${take.n}.${take.mime.includes('mp4') ? 'mp4' : 'webm'}`}>
            ⬇️ ดาวน์โหลดเทคนี้
          </a>
        )}
        <button
          className="danger"
          onClick={async () => {
            if (!confirm('ลบเทคนี้ถาวร?')) return
            update((p) => ({ ...p, takes: p.takes.filter((t) => t.id !== take.id) }))
            await deleteMedia(take.id)
            onClose()
          }}
        >
          🗑 ลบ
        </button>
      </div>
    </Modal>
  )
}

export default function Wrap({ id }) {
  const [project, update, flush] = useProject(id)
  const [settings] = useSettings()
  const [open, setOpen] = useState(null)
  const [job, setJob] = useState(null) // { label, done }
  const [subs, setSubs] = useState(true)
  const [sentId, setSentId] = useState(null)
  const [error, setError] = useState('')

  if (project === undefined) return <div className="empty">กำลังโหลด…</div>
  if (!project)
    return (
      <div className="page empty">
        ไม่พบโปรเจค <a href="#/">กลับหน้าแรก</a>
      </div>
    )

  const pr = progress(project)
  const items = editList(project)
  const missing = project.scenes.filter((s) => !bestTake(project, s.id))
  const direct = canHandoff(settings.kincutUrl)
  const orphans = project.takes.filter((t) => !project.scenes.some((s) => s.id === t.sceneId))
  const editLength = items.reduce((s, x) => s + x.take.duration, 0)

  async function runJob(fn) {
    setError('')
    await flush()
    try {
      await fn((p) => setJob(p))
    } catch (e) {
      if (e?.name !== 'AbortError') setError(e.message ?? String(e))
    } finally {
      setJob(null)
    }
  }

  const slug = project.name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)

  return (
    <div className="page">
      <div className="topbar">
        <BackButton to={`#/p/${id}/plan/script`} />
        <div className="title">ตรวจเทค & ส่งตัดต่อ</div>
      </div>

      <div className="card stack" style={{ marginBottom: 14 }}>
        <div className="row">
          <strong className="grow">
            ถ่ายแล้ว {pr.done}/{pr.total} ฉาก
          </strong>
          <span className="chip">ความยาวรวม ~{fmtTime(editLength)}</span>
        </div>
        <Progress value={pr.total ? pr.done / pr.total : 0} />
        {missing.length > 0 && (
          <div className="small muted">
            ยังขาด: {missing.map((s) => s.title).join(', ')} —{' '}
            <a href={`#/p/${id}/shoot/${project.scenes.indexOf(missing[0])}`}>ไปถ่ายต่อ</a>
          </div>
        )}
      </div>

      <div className="stack">
        {project.scenes.map((s, i) => {
          const takes = project.takes.filter((t) => t.sceneId === s.id)
          const best = bestTake(project, s.id)
          const st = sceneStatus(project, s)
          return (
            <div key={s.id} className="card stack" style={{ gap: 8 }}>
              <div className="scene-head">
                <span className={`scene-num ${st === 'done' ? 'done' : ''}`}>{i + 1}</span>
                <strong className="grow">{s.title}</strong>
                <button onClick={() => go('p', id, 'shoot', String(i))}>🎥</button>
              </div>
              {takes.length ? (
                <div className="takes">
                  {takes.map((t) => (
                    <button
                      key={t.id}
                      className={`take ${t.id === best?.id ? 'best' : t.rating === 'good' ? 'good' : t.rating === 'bad' ? 'bad' : ''}`}
                      onClick={() => setOpen(t)}
                    >
                      {t.thumb ? <img src={t.thumb} alt="" /> : <div style={{ aspectRatio: '9/12' }} />}
                      <span className="meta">
                        <span>
                          {t.id === best?.id ? '⭐' : ''}#{t.n}
                        </span>
                        <span>{fmtTime(t.duration)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="small muted">ยังไม่มีเทค</div>
              )}
            </div>
          )
        })}
        {orphans.length > 0 && (
          <div className="card small muted">
            มี {orphans.length} เทคจากบทเดิมที่ไม่ผูกกับฉากปัจจุบัน (อยู่ในไฟล์แบ็กอัป)
            <div className="takes" style={{ marginTop: 8 }}>
              {orphans.map((t) => (
                <button key={t.id} className="take" onClick={() => setOpen(t)}>
                  {t.thumb && <img src={t.thumb} alt="" />}
                  <span className="meta">
                    <span>#{t.n}</span>
                    <span>{fmtTime(t.duration)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <h2 style={{ marginTop: 22 }}>ส่งต่อไปตัดต่อ</h2>
      {job && (
        <div className="card" style={{ marginBottom: 12 }}>
          <Progress value={job.done} label={job.label} />
        </div>
      )}
      {error && (
        <div className="notice err" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div className="stack">
        <div className="card stack">
          <strong>✂️ KinCut (แนะนำ)</strong>
          <div className="small muted">
            สร้างโปรเจค KinCut ใหม่ที่เรียงเทคที่ดีที่สุดตามลำดับฉาก พร้อมซับร่างจากบทพูด แล้วเปิด KinCut ตัดต่อต่อได้ทันที
          </div>
          <label className="check small">
            <input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} />
            ใส่ซับร่างจากบท (KinCut จะแทนที่ให้ถ้าสั่ง “ซับอัตโนมัติ”)
          </label>
          {direct ? (
            <>
              <button
                className="primary big"
                disabled={!items.length || !!job}
                onClick={() =>
                  runJob(async (onProgress) => {
                    const kid = await sendToKincut(project, { subtitles: subs, onProgress })
                    setSentId(kid)
                    toast('ส่งเข้า KinCut แล้ว ✓')
                  })
                }
              >
                ส่งเข้า KinCut ({items.length} คลิป)
              </button>
              {sentId && (
                <a className="btn" href={settings.kincutUrl} target="_blank" rel="noreferrer">
                  เปิด KinCut → โปรเจค “{project.name}” อยู่หน้าแรก ↗
                </a>
              )}
            </>
          ) : (
            <>
              <div className="notice small">
                ส่งตรงได้เมื่อเปิด KinShot จากเว็บเดียวกับ KinCut ({new URL(settings.kincutUrl).host}) — ตอนนี้ให้ดาวน์โหลดไฟล์แล้วกด “นำเข้า” ใน KinCut
              </div>
              <button disabled={!items.length || !!job} onClick={() => runJob(async (p) => download(await editorZip(project, settings.wpm, p), `${slug}.zip`))}>
                ⬇️ ดาวน์โหลดคลิปเรียงลำดับ (.zip)
              </button>
              <a className="btn" href={settings.kincutUrl} target="_blank" rel="noreferrer">
                เปิด KinCut ↗
              </a>
            </>
          )}
        </div>

        <div className="card stack">
          <strong>📦 แอปตัดต่ออื่น (CapCut · Premiere · DaVinci · Final Cut)</strong>
          <div className="small muted">ไฟล์ชื่อเรียงตามฉาก (01_, 02_ …) + ซับ .srt ต่อคลิปและทั้งเรื่อง + บทถ่ายทำ</div>
          <div className="row">
            <button
              className="grow"
              disabled={!items.length || !!job}
              onClick={() =>
                runJob(async () => {
                  const files = await editorFiles(project, settings.wpm)
                  if (!(await shareFiles(files, project.name))) toast('อุปกรณ์นี้แชร์หลายไฟล์ไม่ได้ ใช้ ZIP แทน')
                })
              }
            >
              📤 แชร์ / บันทึกลงเครื่อง
            </button>
            {canSaveToFolder() && (
              <button className="grow" disabled={!items.length || !!job} onClick={() => runJob(async (p) => saveToFolder(await editorFiles(project, settings.wpm), slug, p))}>
                📁 บันทึกลงโฟลเดอร์
              </button>
            )}
            <button className="grow" disabled={!items.length || !!job} onClick={() => runJob(async (p) => download(await editorZip(project, settings.wpm, p), `${slug}.zip`))}>
              ⬇️ ZIP
            </button>
          </div>
        </div>

        <div className="card stack">
          <strong>🛟 แบ็กอัปโปรเจค</strong>
          <div className="small muted">เก็บบท + ทุกเทค (รวมเทคที่ไม่ใช้) เป็นไฟล์เดียว เอาไปเปิดต่อเครื่องอื่นได้ที่หน้าแรก → “กู้คืน”</div>
          <button disabled={!project.takes.length || !!job} onClick={() => runJob(async (p) => download(await backupZip(project, p), `${slug}.kinshot.zip`))}>
            💾 ดาวน์โหลดแบ็กอัป
          </button>
        </div>

        {(project.caption || project.hashtags?.length) && (
          <div className="card stack">
            <strong>📝 แคปชันสำหรับโพสต์</strong>
            <pre className="out">{[project.caption, project.hashtags?.join(' ')].filter(Boolean).join('\n\n')}</pre>
            <button onClick={() => copyText([project.caption, project.hashtags?.join(' ')].filter(Boolean).join('\n\n'))}>📋 คัดลอกแคปชัน</button>
          </div>
        )}
        <button className="ghost" onClick={() => copyText(shootingScript(project, settings.wpm))}>
          📋 คัดลอกบทถ่ายทำทั้งหมด (Markdown)
        </button>
      </div>

      {open && <TakePlayer project={project} take={project.takes.find((t) => t.id === open.id) ?? open} update={update} onClose={() => setOpen(null)} />}
    </div>
  )
}
