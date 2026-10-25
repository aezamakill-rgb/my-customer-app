import { useEffect, useState } from 'react'
import { useSettings } from '../lib/store.js'
import { DEFAULT_SETTINGS, storageInfo, persistStorage } from '../lib/db.js'
import { PROVIDERS, ROLES } from '../lib/ai/prompts.js'
import { callProvider } from '../lib/ai/providers.js'
import { pickMime } from '../lib/recorder.js'
import { speechSupported } from '../lib/follow.js'
import { BackButton } from '../components/ui.jsx'
import { toast, fmtBytes } from '../lib/notify.js'

const KEY_HELP = {
  claude: { url: 'https://platform.claude.com/settings/keys', hint: 'sk-ant-…' },
  openai: { url: 'https://platform.openai.com/api-keys', hint: 'sk-…' },
  gemini: { url: 'https://aistudio.google.com/app/apikey', hint: 'AIza…' },
}

export default function Settings() {
  const [s, set] = useSettings()
  const [storage, setStorage] = useState(null)
  const [persisted, setPersisted] = useState(null)
  const [testing, setTesting] = useState('')

  useEffect(() => {
    storageInfo().then(setStorage)
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {})
  }, [])

  async function test(p) {
    setTesting(p)
    try {
      const r = await callProvider(p, s, { system: 'ตอบสั้นที่สุด', user: 'ตอบคำว่า "พร้อม" คำเดียว' })
      toast(`${PROVIDERS[p].name} พร้อมใช้ ✓ (${r.model})`)
    } catch (e) {
      toast(e.message ?? String(e), 5000)
    } finally {
      setTesting('')
    }
  }

  const mime = pickMime()

  return (
    <div className="page">
      <div className="topbar">
        <BackButton />
        <div className="title">ตั้งค่า</div>
      </div>
      <div className="stack">
        <div className="card stack">
          <h3>🤝 ทีม AI</h3>
          <div className="row">
            <button className={s.aiMode === 'paste' ? 'on' : ''} onClick={() => set({ aiMode: 'paste' })}>
              คัดลอก/วาง (ฟรี)
            </button>
            <button className={s.aiMode === 'api' ? 'on' : ''} onClick={() => set({ aiMode: 'api' })}>
              API อัตโนมัติ
            </button>
          </div>
          <div className="small muted">
            API key เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น ส่งตรงไปยังผู้ให้บริการแต่ละเจ้า ไม่ผ่านเซิร์ฟเวอร์อื่น — อย่าใช้บนเครื่องสาธารณะ
          </div>
          {Object.entries(PROVIDERS).map(([p, info]) => (
            <div key={p} className="stack" style={{ gap: 6 }}>
              <div className="row">
                <strong className={`grow chip ${p}`} style={{ border: 0, background: 'none', padding: 0, fontSize: '1rem' }}>
                  {info.name}
                </strong>
                <a className="small" href={KEY_HELP[p].url} target="_blank" rel="noreferrer">
                  ขอ API key ↗
                </a>
              </div>
              <input
                type="password"
                autoComplete="off"
                placeholder={`API key (${KEY_HELP[p].hint})`}
                value={s.keys[p]}
                onChange={(e) => set((cur) => ({ keys: { ...cur.keys, [p]: e.target.value.trim() } }))}
              />
              <div className="row">
                <input
                  className="grow"
                  placeholder="รุ่นโมเดล (เว้นว่าง = เลือกรุ่นล่าสุดให้อัตโนมัติ)"
                  value={s.models[p]}
                  onChange={(e) => set((cur) => ({ models: { ...cur.models, [p]: e.target.value.trim() } }))}
                />
                <button disabled={!s.keys[p] || !!testing} onClick={() => test(p)}>
                  {testing === p ? 'กำลังทดสอบ…' : 'ทดสอบ'}
                </button>
              </div>
            </div>
          ))}
          <div className="grid2">
            {Object.entries(ROLES).map(([r, info]) => (
              <label key={r} className="field">
                {info.emoji} {info.name}
                <select value={s.roles[r]} onChange={(e) => set((cur) => ({ roles: { ...cur.roles, [r]: e.target.value } }))}>
                  {Object.entries(PROVIDERS).map(([p, v]) => (
                    <option key={p} value={p}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div className="card stack">
          <h3>🎙 Teleprompter</h3>
          <label className="field">
            ความเร็วพูด {s.wpm} คำ/นาที (ไทยปกติ ~150-190)
            <input type="range" min="80" max="320" step="10" value={s.wpm} onChange={(e) => set({ wpm: Number(e.target.value) })} />
          </label>
          <label className="field">
            ขนาดตัวอักษร {s.prompterSize}px
            <input type="range" min="20" max="64" value={s.prompterSize} onChange={(e) => set({ prompterSize: Number(e.target.value) })} />
          </label>
          <label className="field">
            โหมดเลื่อนบท
            <select value={s.prompterMode} onChange={(e) => set({ prompterMode: e.target.value })}>
              <option value="auto">อัตโนมัติตามความเร็วพูด</option>
              <option value="voice" disabled={!speechSupported()}>
                ตามเสียงพูด {speechSupported() ? '' : '(อุปกรณ์นี้ไม่รองรับ)'}
              </option>
              <option value="manual">แตะ/รีโมตเอง</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.prompterMirror} onChange={(e) => set({ prompterMirror: e.target.checked })} />
            กลับด้านตัวอักษร (สำหรับกระจก teleprompter)
          </label>
        </div>

        <div className="card stack">
          <h3>🔗 KinCut</h3>
          <label className="field">
            ที่อยู่ KinCut
            <input value={s.kincutUrl} onChange={(e) => set({ kincutUrl: e.target.value.trim() || DEFAULT_SETTINGS.kincutUrl })} />
          </label>
        </div>

        <div className="card small stack">
          <h3>🧰 อุปกรณ์นี้</h3>
          <div>ไฟล์ที่อัด: {mime ? mime.split(';')[0] : 'ไม่รองรับการอัด'}</div>
          <div>ฟังเสียงตามบท: {speechSupported() ? 'รองรับ' : 'ไม่รองรับ'}</div>
          {storage && (
            <div>
              พื้นที่: ใช้ {fmtBytes(storage.used)} จาก {fmtBytes(storage.quota)} · {persisted ? 'ป้องกันการลบอัตโนมัติแล้ว' : 'ยังไม่ได้ป้องกันการลบอัตโนมัติ'}
            </div>
          )}
          {!persisted && (
            <button onClick={async () => setPersisted(await persistStorage())}>ขอให้เบราว์เซอร์เก็บไฟล์ถาวร</button>
          )}
        </div>
        <button
          className="ghost danger"
          onClick={() => confirm('รีเซ็ตการตั้งค่าทั้งหมด (รวม API key)?') && set({ ...DEFAULT_SETTINGS })}
        >
          รีเซ็ตการตั้งค่า
        </button>
      </div>
    </div>
  )
}
