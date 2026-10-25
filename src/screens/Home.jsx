import { useEffect, useRef, useState } from 'react'
import { listProjects, saveProject, deleteProject, persistStorage, storageInfo } from '../lib/db.js'
import { newProject, PLATFORMS, progress, totalSeconds, fmtTime } from '../lib/model.js'
import { TEMPLATES } from '../lib/templates.js'
import { restoreBackup } from '../lib/export.js'
import { go, useSettings } from '../lib/store.js'
import { Modal } from '../components/ui.jsx'
import { toast, fmtBytes } from '../lib/notify.js'

// Chrome/Edge/Android fire this when the app can be installed.
let installEvent = null
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e
  dispatchEvent(new Event('kinshot:installable'))
})

function useInstall() {
  const [ev, setEv] = useState(installEvent)
  useEffect(() => {
    const on = () => setEv(installEvent)
    addEventListener('kinshot:installable', on)
    return () => removeEventListener('kinshot:installable', on)
  }, [])
  return ev && (() => {
    ev.prompt()
    installEvent = null
    setEv(null)
  })
}

function NewProject({ onClose }) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState('tiktok')

  async function create(template) {
    const pf = PLATFORMS.find((p) => p.id === platform)
    const p = newProject({
      name: name.trim() || topic.trim() || 'คอนเทนต์ใหม่',
      topic: topic.trim(),
      platform,
      aspect: pf.aspect,
      targetSeconds: pf.seconds,
      scenes: template ? template.build(topic) : [],
    })
    await saveProject(p)
    onClose()
    go('p', p.id, 'plan', template ? 'script' : 'team')
  }

  return (
    <Modal onClose={onClose}>
      <h2>โปรเจคใหม่</h2>
      <label className="field">
        หัวข้อคอนเทนต์
        <input autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="เช่น รีวิวกล้องมือถือ งบ 10,000" />
      </label>
      <label className="field">
        ชื่อโปรเจค (ไม่ใส่ก็ได้)
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ใช้หัวข้อเป็นชื่อ" />
      </label>
      <label className="field">
        ลงแพลตฟอร์ม
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.aspect} · ~{p.seconds} วิ
            </option>
          ))}
        </select>
      </label>
      <button className="primary big" onClick={() => create(null)}>
        ✨ ให้ทีม AI (Claude · GPT · Gemini) เขียนบท
      </button>
      <div className="small muted">หรือเริ่มจากโครงสำเร็จรูป (ไม่ต้องใช้ AI)</div>
      <div className="template-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => create(t)}>
            <span className="emoji">{t.emoji}</span>
            {t.name}
          </button>
        ))}
      </div>
    </Modal>
  )
}

export default function Home() {
  const [projects, setProjects] = useState(null)
  const [creating, setCreating] = useState(false)
  const [storage, setStorage] = useState(null)
  const [settings] = useSettings()
  const fileRef = useRef()
  const install = useInstall()

  const refresh = () => listProjects().then(setProjects)
  useEffect(() => {
    refresh()
    persistStorage()
    storageInfo().then(setStorage)
  }, [])

  async function onRestore(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const p = await restoreBackup(f)
      toast('กู้คืนโปรเจคแล้ว')
      go('p', p.id, 'wrap')
    } catch (err) {
      toast(err.message)
    }
  }

  async function remove(p) {
    if (!confirm(`ลบ "${p.name}" และวิดีโอทั้งหมดในโปรเจคนี้?`)) return
    await deleteProject(p)
    refresh()
  }

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand title">
          <img className="logo" src="./icons/icon-192.png" alt="" />
          KinShot
        </div>
        <a className="btn icon ghost" href="#/guide" aria-label="วิธีใช้">
          ❔
        </a>
        <a className="btn icon ghost" href="#/settings" aria-label="ตั้งค่า">
          ⚙️
        </a>
      </div>
      <p className="muted">ผู้ช่วยกองถ่ายในกระเป๋า: วางบทด้วยทีม AI → ถ่ายพร้อม teleprompter และคุมกล้องแบบมือโปร → ส่งต่อ KinCut ตัดต่อทันที</p>

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="primary big grow" onClick={() => setCreating(true)}>
          + เริ่มคอนเทนต์ใหม่
        </button>
        {install && (
          <button className="big" onClick={install}>
            ⬇️ ติดตั้งแอป
          </button>
        )}
      </div>

      {projects === null ? (
        <div className="empty">กำลังโหลด…</div>
      ) : projects.length === 0 ? (
        <div className="card empty">
          <p style={{ fontSize: '2rem', margin: 0 }}>🎬</p>
          <p>ยังไม่มีโปรเจค กด “เริ่มคอนเทนต์ใหม่” แล้วเลือกให้ AI เขียนบทหรือใช้โครงสำเร็จรูป</p>
          <a href="#/guide">อ่านวิธีใช้ 2 นาที →</a>
        </div>
      ) : (
        <div className="stack">
          {projects.map((p) => {
            const pr = progress(p)
            return (
              <div key={p.id} className="card project-card" onClick={() => go('p', p.id, pr.done ? 'wrap' : 'plan')}>
                <div className="row">
                  <strong className="grow">{p.name}</strong>
                  <span className="chip">{p.aspect}</span>
                  <button
                    className="icon ghost danger"
                    aria-label="ลบ"
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(p)
                    }}
                  >
                    🗑
                  </button>
                </div>
                <div className="small muted">
                  {p.scenes.length} ฉาก · ~{fmtTime(totalSeconds(p, settings.wpm))} · ถ่ายแล้ว {pr.done}/{pr.total} ฉาก · {p.takes.length} เทค
                </div>
                <div className="bar">
                  <i style={{ width: `${pr.total ? (pr.done / pr.total) * 100 : 0}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <button className="ghost small" onClick={() => fileRef.current.click()}>
          ⤒ กู้คืนจากไฟล์แบ็กอัป (.zip)
        </button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={onRestore} />
        {storage && (
          <span className="small muted">
            พื้นที่ใช้ไป {fmtBytes(storage.used)} / {fmtBytes(storage.quota)}
          </span>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 18 }}>
        วิดีโอทั้งหมดเก็บในเครื่องนี้เท่านั้น · ทีม AI สามแรง: Claude · GPT · Gemini
      </p>
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </div>
  )
}
