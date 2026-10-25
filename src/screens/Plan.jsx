import { useEffect, useRef, useState } from 'react'
import { useProject, useSettings, go } from '../lib/store.js'
import {
  PLATFORMS,
  ASPECTS,
  SHOT_SIZES,
  ANGLES,
  MOVES,
  newScene,
  sceneSeconds,
  totalSeconds,
  fmtTime,
  sceneStatus,
  prompterLines,
} from '../lib/model.js'
import { PRESHOOT_CHECKLIST, SHOT_TIPS } from '../lib/templates.js'
import { ROLES, PROVIDERS, researchPrompt, writePrompt, directPrompt, teamPrompt, scriptToJson, asPaste } from '../lib/ai/prompts.js'
import { applyAiResult, replacesScenes } from '../lib/ai/apply.js'
import { sendToApp, readClipboard, setPending, getPending, takeIncoming } from '../lib/handoff.js'
import { callProvider, providerFor, readyProviders } from '../lib/ai/providers.js'
import { BackButton } from '../components/ui.jsx'
import { toast } from '../lib/notify.js'

const TABS = [
  ['brief', '📝 บรีฟ'],
  ['team', '🤝 ทีม AI'],
  ['script', '🎞 บท & ช็อต'],
  ['check', '✅ ก่อนถ่าย'],
]

function Brief({ project, update }) {
  const set = (k) => (e) => update({ [k]: e.target.value })
  return (
    <div className="stack">
      <label className="field">
        ชื่อโปรเจค
        <input value={project.name} onChange={set('name')} />
      </label>
      <label className="field">
        หัวข้อ / สินค้า / เรื่องที่จะเล่า
        <textarea value={project.topic} onChange={set('topic')} placeholder="ยิ่งละเอียด AI ยิ่งเขียนบทได้ตรง" />
      </label>
      <div className="grid2">
        <label className="field">
          แพลตฟอร์ม
          <select
            value={project.platform}
            onChange={(e) => {
              const pf = PLATFORMS.find((p) => p.id === e.target.value)
              update({ platform: pf.id, aspect: pf.aspect, targetSeconds: pf.seconds })
            }}
          >
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          สัดส่วนภาพ
          <select value={project.aspect} onChange={set('aspect')}>
            {ASPECTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="field">
          ความยาวเป้าหมาย (วินาที)
          <input
            type="number"
            min="5"
            max="1800"
            value={project.targetSeconds}
            onChange={(e) => update({ targetSeconds: Math.max(5, Number(e.target.value) || 30) })}
          />
        </label>
        <label className="field">
          โทน / สไตล์
          <input value={project.tone} onChange={set('tone')} placeholder="เป็นกันเอง ตลก จริงจัง หรูหรา…" />
        </label>
      </div>
      <label className="field">
        กลุ่มเป้าหมาย
        <input value={project.audience} onChange={set('audience')} placeholder="เช่น วัยทำงาน 25-35 ที่เริ่มทำคอนเทนต์" />
      </label>
      <label className="field">
        เป้าหมายของคลิป
        <input value={project.goal} onChange={set('goal')} placeholder="ยอดขาย / ผู้ติดตาม / ให้ความรู้ / พาไปหน้าร้าน" />
      </label>
      <label className="field">
        ข้อมูลเพิ่มเติม (ราคา จุดเด่น โปรโมชัน สิ่งที่ห้ามพูด)
        <textarea value={project.notes} onChange={set('notes')} />
      </label>
      <a className="btn primary" href={`#/p/${project.id}/plan/team`}>
        ต่อไป: ให้ทีม AI วางบท →
      </a>
    </div>
  )
}

const PROMPTS = {
  oneshot: (p) => teamPrompt(p),
  research: (p) => researchPrompt(p),
  write: (p) => writePrompt(p, p.research),
  direct: (p) => directPrompt(p, scriptToJson(p)),
}

const ONESHOT = { name: 'รอบเดียวจบ', emoji: '⚡', job: 'AI ตัวเดียวทำครบ: รีเสิร์ช → เขียนบท → กำกับ สลับแอปแค่ครั้งเดียว' }

/** Send / paste-back controls for one AI step in copy-paste mode. */
function PasteControls({ role, provider, disabled, manual, onSend, onPaste, onManual, onManualApply }) {
  const [text, setText] = useState('')
  const name = PROVIDERS[provider].name
  return (
    <>
      <div className="row">
        <button className="grow" disabled={disabled} onClick={onSend}>
          📤 ส่งให้ {name}
        </button>
        <button className="primary grow" disabled={disabled} onClick={onPaste}>
          📋 วางคำตอบ
        </button>
      </div>
      {manual ? (
        <>
          <textarea autoFocus placeholder={`แตะค้างแล้วเลือก “วาง” คำตอบจาก ${name}`} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="primary" disabled={!text.trim()} onClick={() => onManualApply(text)}>
            {role === 'research' ? 'บันทึกผลรีเสิร์ช' : 'ใช้บทนี้'}
          </button>
        </>
      ) : (
        <button className="ghost small" onClick={onManual}>
          วางเองในช่องข้อความ
        </button>
      )}
    </>
  )
}

function Team({ project, update }) {
  const [settings, setSettings] = useSettings()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState(null)
  const [pending, setPendingState] = useState(() => {
    const p = getPending()
    return p?.projectId === project.id ? p : null
  })
  const abort = useRef(null)
  const api = settings.aiMode === 'api'
  const ready = readyProviders(settings)
  const steps = ['research', 'write', 'direct']
  const providerOf = (role) => (role === 'oneshot' ? settings.oneShotProvider ?? 'gemini' : settings.roles[role])

  const confirmReplace = (role) =>
    !replacesScenes(role) || !project.takes.length || confirm('บทใหม่จะแทนที่ฉากเดิม เทคที่ถ่ายไว้จะไม่ผูกกับฉากใหม่ (ยังอยู่ในแบ็กอัป) ทำต่อ?')

  async function runApi(roles) {
    if (!confirmReplace(roles.length > 1 ? 'all' : roles[0])) return
    setError('')
    abort.current = new AbortController()
    let p = project
    try {
      for (const role of roles) {
        const provider = providerFor(role, settings)
        if (!provider) throw new Error('ยังไม่มี API key — ไปที่ ⚙️ ตั้งค่า หรือใช้โหมดคัดลอก/วาง')
        setBusy(role)
        const res = await callProvider(provider, settings, PROMPTS[role](p), {
          json: role !== 'research',
          research: role === 'research',
          signal: abort.current.signal,
        })
        p = applyAiResult(p, role, res.text, { by: provider, model: res.model, sources: res.sources })
        update(p)
      }
      toast('ทีม AI ทำเสร็จแล้ว ✓')
    } catch (e) {
      if (e?.name !== 'AbortError') setError(e.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  function markPending(p) {
    setPending(p)
    setPendingState(p)
  }

  async function send(role) {
    setError('')
    const provider = providerOf(role)
    markPending({ projectId: project.id, role, provider })
    const how = await sendToApp(asPaste(PROMPTS[role](project)), PROVIDERS[provider].app)
    if (how === 'shared') toast(`เลือกแอป ${PROVIDERS[provider].name} ในเมนูแชร์ → ส่ง → คัดลอกคำตอบแล้วกลับมาแตะ “วางคำตอบ”`, 5000)
    else if (how === 'opened') toast('คัดลอก prompt แล้ว วางในแอป AI ได้เลย', 4000)
  }

  /** Apply an answer; `quiet` = automatic attempt, stay silent if it isn't one. */
  function accept(role, text, { quiet = false } = {}) {
    let next
    try {
      next = applyAiResult(project, role, text, { by: providerOf(role) })
    } catch (e) {
      if (!quiet) setError(e.message)
      return false
    }
    if (!confirmReplace(role)) return false
    update(next)
    markPending(null)
    setManual(null)
    setError('')
    if (role === 'research') toast('บันทึกผลรีเสิร์ชแล้ว ✓ ต่อขั้นที่ 2 ได้เลย')
    else if (role === 'write') toast('ได้บทแล้ว ✓ ส่งให้ผู้กำกับตรวจต่อ (ขั้นที่ 3) หรือไปดูบทได้เลย')
    else {
      toast(`ได้บทแล้ว ${next.scenes.length} ฉาก ✓`)
      go('p', project.id, 'plan', 'script')
    }
    return true
  }

  async function pasteFromClipboard(role) {
    const text = await readClipboard()
    if (text === null) {
      setManual(role)
      setError('เบราว์เซอร์นี้ไม่ให้อ่านคลิปบอร์ด — แตะค้างในช่องด้านล่างแล้วเลือก “วาง”')
      return
    }
    accept(role, text)
  }

  // Coming back from the AI app: pick the answer up automatically where the
  // browser allows (Android Chrome after the first "allow"), or from a share.
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const acceptRef = useRef(accept)
  acceptRef.current = accept
  useEffect(() => {
    const incoming = takeIncoming()
    if (incoming && pendingRef.current) acceptRef.current(pendingRef.current.role, incoming)
    let last = ''
    const onReturn = async () => {
      if (document.visibilityState !== 'visible' || !pendingRef.current) return
      const text = await readClipboard({ quiet: true })
      if (!text || text === last) return
      last = text
      acceptRef.current(pendingRef.current.role, text, { quiet: true })
    }
    addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [])

  const roleInfo = (role) => (role === 'oneshot' ? ONESHOT : ROLES[role])
  const providerSelect = (role) => (
    <select
      aria-label="AI ที่รับงานนี้"
      style={{ width: 'auto' }}
      value={providerOf(role)}
      onChange={(e) =>
        role === 'oneshot'
          ? setSettings({ oneShotProvider: e.target.value })
          : setSettings((s) => ({ roles: { ...s.roles, [role]: e.target.value } }))
      }
    >
      {Object.entries(PROVIDERS).map(([id, p]) => (
        <option key={id} value={id}>
          {p.name}
        </option>
      ))}
    </select>
  )

  const doneChips = (role) => {
    const done = project.ai?.[role]
    return (
      done && (
        <div className="chips">
          <span className="chip ok">✓ เสร็จแล้ว</span>
          {done.by && <span className={`chip ${done.by}`}>{PROVIDERS[done.by]?.name}</span>}
          {done.model && <span className="chip">{done.model}</span>}
        </div>
      )
    )
  }

  const pasteFor = (role, disabled = false) => (
    <PasteControls
      key={`${role}-${manual === role}`}
      role={role}
      provider={providerOf(role)}
      disabled={disabled}
      manual={manual === role}
      onSend={() => send(role)}
      onPaste={() => pasteFromClipboard(role)}
      onManual={() => setManual(role)}
      onManualApply={(t) => accept(role, t)}
    />
  )

  const stepCard = (role, i) => {
    const info = ROLES[role]
    const provider = api ? (providerFor(role, settings) ?? settings.roles[role]) : settings.roles[role]
    const needsScript = role === 'direct' && !project.scenes.length
    return (
      <div key={role} className={`card stack step ${provider}`}>
        <div className="row">
          <strong className="grow">
            {i + 1}. {info.emoji} {info.name}
          </strong>
          {providerSelect(role)}
        </div>
        <div className="small muted">{info.job}</div>
        {doneChips(role)}
        {role === 'write' && !project.research && <div className="small muted">ข้ามขั้นรีเสิร์ชได้ แต่บทจะแม่นขึ้นถ้ามีข้อมูล</div>}
        {needsScript && <div className="small muted">ต้องมีบทก่อน (ขั้นที่ 2 หรือโครงสำเร็จรูป)</div>}
        {api ? (
          <button disabled={!!busy || needsScript} onClick={() => runApi([role])}>
            {busy === role ? 'กำลังทำ…' : project.ai?.[role] ? 'ทำขั้นนี้ใหม่' : 'รันขั้นนี้'}
          </button>
        ) : (
          pasteFor(role, needsScript)
        )}
        {role === 'research' && project.research && (
          <details>
            <summary className="small">ผลรีเสิร์ช</summary>
            <pre className="out">{project.research}</pre>
            {project.ai?.research?.sources?.length > 0 && (
              <ul className="small">
                {project.ai.research.sources.slice(0, 12).map((s, k) => (
                  <li key={k}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
      </div>
    )
  }

  return (
    <div className="team">
      {pending && !api && (
        <div className="card stack notice">
          <strong>
            ⏳ รอคำตอบจาก {PROVIDERS[pending.provider]?.name} · {roleInfo(pending.role).emoji} {roleInfo(pending.role).name}
          </strong>
          <div className="small">คัดลอกคำตอบทั้งหมดในแอป AI แล้วกลับมาแตะปุ่มนี้</div>
          <button className="primary big" onClick={() => pasteFromClipboard(pending.role)}>
            📋 วางคำตอบ
          </button>
          <button className="ghost small" onClick={() => markPending(null)}>
            ยกเลิกการรอ
          </button>
        </div>
      )}

      <div className="card stack">
        <div className="row">
          <strong className="grow">โหมด AI</strong>
          <button className={!api ? 'on' : ''} onClick={() => setSettings({ aiMode: 'paste' })}>
            ใช้แอป AI (ฟรี)
          </button>
          <button className={api ? 'on' : ''} onClick={() => setSettings({ aiMode: 'api' })}>
            API อัตโนมัติ
          </button>
        </div>
        <div className="small muted">
          {api
            ? ready.length
              ? `พร้อมใช้: ${ready.map((p) => PROVIDERS[p].name).join(' · ')} — ไม่ต้องสลับแอปเลย บทบาทไหนไม่มี key จะใช้ AI ตัวที่มี key แทน`
              : 'ยังไม่มี API key — ใส่ได้ที่ ⚙️ ตั้งค่า (key เก็บในเครื่องนี้เท่านั้น)'
            : '“ส่งให้” เปิดเมนูแชร์ แตะแอป AI แล้ว prompt เข้าไปเอง → คัดลอกคำตอบ → กลับมาแตะ “วางคำตอบ”'}
        </div>
        {api && (
          <button className="primary big" disabled={!!busy || !ready.length} onClick={() => runApi(steps)}>
            {busy ? `กำลังทำงาน: ${ROLES[busy].name}…` : '🚀 ให้ทีม AI ทำครบ 3 ขั้นอัตโนมัติ'}
          </button>
        )}
        {busy && (
          <button className="ghost" onClick={() => abort.current?.abort()}>
            หยุด
          </button>
        )}
        {error && <div className="notice err">{error}</div>}
      </div>

      {api ? (
        steps.map(stepCard)
      ) : (
        <>
          <div className={`card stack step ${providerOf('oneshot')}`}>
            <div className="row">
              <strong className="grow">
                {ONESHOT.emoji} {ONESHOT.name} <span className="chip ok">แนะนำ</span>
              </strong>
              {providerSelect('oneshot')}
            </div>
            <div className="small muted">{ONESHOT.job}</div>
            {doneChips('oneshot')}
            {pasteFor('oneshot')}
          </div>
          <details className="card" open={['research', 'write', 'direct'].includes(pending?.role) || undefined}>
            <summary>
              <strong>🤝 แบบ 3 AI ช่วยกัน</strong> <span className="small muted">— ละเอียดกว่า สลับแอป 3 ครั้ง</span>
            </summary>
            <div className="team" style={{ marginTop: 12 }}>
              {steps.map(stepCard)}
            </div>
          </details>
        </>
      )}

      {project.scenes.length > 0 && (
        <a className="btn primary" href={`#/p/${project.id}/plan/script`}>
          ดูบท & ช็อต ({project.scenes.length} ฉาก) →
        </a>
      )}
    </div>
  )
}

function SceneCard({ project, scene, index, update, wpm }) {
  const setScene = (patch) =>
    update((p) => ({ ...p, scenes: p.scenes.map((s) => (s.id === scene.id ? { ...s, ...patch } : s)) }))
  const setShot = (k) => (e) => setScene({ shot: { ...scene.shot, [k]: e.target.value } })
  const move = (d) =>
    update((p) => {
      const list = [...p.scenes]
      const j = index + d
      if (j < 0 || j >= list.length) return p
      ;[list[index], list[j]] = [list[j], list[index]]
      return { ...p, scenes: list }
    })
  const status = sceneStatus(project, scene)
  const secs = sceneSeconds(scene, wpm)

  return (
    <div className="card scene">
      <div className="scene-head">
        <span className={`scene-num ${status === 'done' ? 'done' : ''}`}>{index + 1}</span>
        <input className="grow" value={scene.title} onChange={(e) => setScene({ title: e.target.value })} aria-label="ชื่อฉาก" />
        <span className="chip">~{fmtTime(secs)}</span>
      </div>
      <div className="row">
        <button className={scene.kind === 'talk' ? 'on' : ''} onClick={() => setScene({ kind: 'talk' })}>
          🗣 พูด
        </button>
        <button className={scene.kind === 'broll' ? 'on' : ''} onClick={() => setScene({ kind: 'broll' })}>
          🎥 B-roll
        </button>
        <select style={{ width: 'auto' }} value={scene.shot.camera} onChange={setShot('camera')} aria-label="กล้อง">
          <option value="front">กล้องหน้า</option>
          <option value="back">กล้องหลัง</option>
        </select>
      </div>
      {scene.kind === 'talk' && (
        <label className="field">
          บทพูด (1 บรรทัด = 1 ลมหายใจ)
          <textarea value={scene.lines} onChange={(e) => setScene({ lines: e.target.value })} rows={Math.max(3, prompterLines(scene.lines).length + 1)} />
        </label>
      )}
      <div className="grid2">
        <label className="field">
          ขนาดช็อต
          <select value={scene.shot.size} onChange={setShot('size')}>
            {Object.entries(SHOT_SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {k} · {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          มุมกล้อง
          <select value={scene.shot.angle} onChange={setShot('angle')}>
            {Object.entries(ANGLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          การเคลื่อนกล้อง
          <select value={scene.shot.move} onChange={setShot('move')}>
            {Object.entries(MOVES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          ความยาว (วินาที, 0 = คำนวณจากบท)
          <input type="number" min="0" max="600" value={scene.seconds} onChange={(e) => setScene({ seconds: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      </div>
      <div className="small muted">💡 {SHOT_TIPS[scene.shot.size]}</div>
      <label className="field">
        คำสั่งผู้กำกับ (ท่าทาง อารมณ์ สิ่งที่อยู่ในเฟรม)
        <textarea rows={2} value={scene.direction} onChange={(e) => setScene({ direction: e.target.value })} />
      </label>
      <div className="row">
        <button className="icon" onClick={() => move(-1)} disabled={index === 0} aria-label="เลื่อนขึ้น">
          ↑
        </button>
        <button className="icon" onClick={() => move(1)} disabled={index === project.scenes.length - 1} aria-label="เลื่อนลง">
          ↓
        </button>
        <button
          className="icon"
          aria-label="ทำซ้ำ"
          onClick={() =>
            update((p) => {
              const list = [...p.scenes]
              list.splice(index + 1, 0, newScene({ ...scene, id: undefined, title: `${scene.title} (2)` }))
              return { ...p, scenes: list }
            })
          }
        >
          ⧉
        </button>
        <button
          className="icon danger"
          aria-label="ลบฉาก"
          onClick={() => confirm(`ลบฉาก "${scene.title}"?`) && update((p) => ({ ...p, scenes: p.scenes.filter((s) => s.id !== scene.id) }))}
        >
          🗑
        </button>
        <span className="grow" />
        <button onClick={() => go('p', project.id, 'shoot', String(index))}>🎥 ถ่ายฉากนี้</button>
      </div>
    </div>
  )
}

function Script({ project, update }) {
  const [settings] = useSettings()
  const total = totalSeconds(project, settings.wpm)
  const over = total > project.targetSeconds * 1.2
  const firstTalk = project.scenes.find((s) => s.kind === 'talk')
  return (
    <div className="stack">
      <div className="card tight row">
        <span className="grow">
          รวม <strong>{fmtTime(total)}</strong> / เป้าหมาย {fmtTime(project.targetSeconds)}
        </span>
        <span className={`chip ${over ? 'warn' : 'ok'}`}>{over ? 'ยาวเกิน ลองตัดบท' : 'ความยาวดี'}</span>
      </div>
      {project.hookOptions?.length > 0 && firstTalk && (
        <div className="card stack">
          <strong>ทางเลือก Hook (แตะเพื่อใช้เป็นบรรทัดแรก)</strong>
          {project.hookOptions.map((h, i) => (
            <button
              key={i}
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() =>
                update((p) => ({
                  ...p,
                  scenes: p.scenes.map((s) => {
                    if (s.id !== firstTalk.id) return s
                    const lines = prompterLines(s.lines)
                    lines[0] = h
                    return { ...s, lines: lines.join('\n') }
                  }),
                }))
              }
            >
              {h}
            </button>
          ))}
        </div>
      )}
      {project.scenes.length === 0 && (
        <div className="card empty">
          ยังไม่มีฉาก ให้ <a href={`#/p/${project.id}/plan/team`}>ทีม AI</a> เขียนให้ หรือเพิ่มฉากเอง
        </div>
      )}
      {project.scenes.map((s, i) => (
        <SceneCard key={s.id} project={project} scene={s} index={i} update={update} wpm={settings.wpm} />
      ))}
      <button onClick={() => update((p) => ({ ...p, scenes: [...p.scenes, newScene({ title: `ฉาก ${p.scenes.length + 1}` })] }))}>
        + เพิ่มฉาก
      </button>
      {project.editNotes?.length > 0 && (
        <div className="card">
          <strong>โน้ตสำหรับตัดต่อจากทีม AI</strong>
          <ul className="small">
            {project.editNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Check({ project }) {
  const [ticked, setTicked] = useState({})
  return (
    <div className="stack">
      <div className="card">
        <h3>เช็กลิสต์ก่อนกดอัด</h3>
        {PRESHOOT_CHECKLIST.map((c, i) => (
          <label key={i} className="check">
            <input type="checkbox" checked={!!ticked[i]} onChange={(e) => setTicked((t) => ({ ...t, [i]: e.target.checked }))} />
            {c}
          </label>
        ))}
      </div>
      <div className="card small">
        <h3>เคล็ดลับมืออาชีพ</h3>
        <ul>
          <li>อัดแต่ละฉากอย่างน้อย 2 เทค แล้วเลือกเทคที่ดีที่สุดตอนตรวจ</li>
          <li>เว้น 1 วินาทีก่อนเริ่มพูดและหลังพูดจบ ช่วยให้ตัดต่อง่าย</li>
          <li>พูดผิดไม่ต้องหยุด เว้นจังหวะแล้วพูดประโยคนั้นใหม่ ค่อยตัดทีหลัง</li>
          <li>ถ่าย B-roll เผื่อเสมอ ภาพประกอบยิ่งเยอะ คลิปยิ่งดูโปร</li>
          <li>มองเลนส์กล้อง ไม่ใช่มองหน้าจอตัวเอง — บทจะอยู่ด้านบนใกล้กล้องเสมอ</li>
        </ul>
      </div>
      <button className="primary big" disabled={!project.scenes.length} onClick={() => go('p', project.id, 'shoot', '0')}>
        🎥 พร้อมแล้ว เริ่มถ่าย!
      </button>
    </div>
  )
}

export default function Plan({ id, tab }) {
  const [project, update] = useProject(id)
  const current = TABS.some(([t]) => t === tab) ? tab : project?.scenes?.length ? 'script' : 'brief'
  if (project === undefined) return <div className="empty">กำลังโหลด…</div>
  if (project === null)
    return (
      <div className="page empty">
        ไม่พบโปรเจคนี้ <a href="#/">กลับหน้าแรก</a>
      </div>
    )
  const Tab = { brief: Brief, team: Team, script: Script, check: Check }[current]
  return (
    <div className="page">
      <div className="topbar">
        <BackButton />
        <div className="title">{project.name}</div>
        <a className="btn icon ghost" href="#/settings" aria-label="ตั้งค่า">
          ⚙️
        </a>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <a key={t} role="tab" aria-selected={t === current} className={`btn ${t === current ? 'on' : ''}`} href={`#/p/${id}/plan/${t}`}>
            {label}
          </a>
        ))}
      </div>
      <Tab project={project} update={update} />
      <div className="bottombar">
        <div>
          <a className="btn grow" href={`#/p/${id}/wrap`}>
            🎞 ตรวจเทค & ส่งตัดต่อ
          </a>
          <button className="primary grow" disabled={!project.scenes.length} onClick={() => go('p', id, 'shoot', '0')}>
            🎥 เริ่มถ่าย
          </button>
        </div>
      </div>
    </div>
  )
}
