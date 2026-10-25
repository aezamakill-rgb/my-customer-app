import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useProject, useSettings, go } from '../lib/store.js'
import { prompterLines, speakSeconds, sceneSeconds, sceneStatus, fmtTime, uid, SHOT_SIZES, ANGLES, MOVES } from '../lib/model.js'
import { SHOT_TIPS } from '../lib/templates.js'
import { openCamera, stopStream, cameraControls, setControl, focusAt, audioMeter, listCameras, listMics, aspectRatio, cropRect, zoomStops } from '../lib/camera.js'
import { startRecording, probeMedia, thumbnail } from '../lib/recorder.js'
import { putMedia, deleteMedia, storageInfo } from '../lib/db.js'
import { followVoice, speechSupported } from '../lib/follow.js'
import { Modal } from '../components/ui.jsx'
import { toast, fmtBytes } from '../lib/notify.js'

const facingFor = (scene) => (scene?.shot.camera === 'back' ? 'environment' : 'user')

function useWakeLock() {
  useEffect(() => {
    let lock
    const get = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen')
      } catch {
        /* not supported / denied */
      }
    }
    get()
    document.addEventListener('visibilitychange', get)
    return () => {
      document.removeEventListener('visibilitychange', get)
      lock?.release?.().catch(() => {})
    }
  }, [])
}

function useLevel(enabled) {
  const [roll, setRoll] = useState(null)
  useEffect(() => {
    if (!enabled) return setRoll(null)
    const on = (e) => {
      if (e.gamma == null) return
      const angle = screen.orientation?.angle ?? globalThis.orientation ?? 0
      const r = angle === 90 ? -e.beta : angle === -90 || angle === 270 ? e.beta : e.gamma
      setRoll(Math.round(r * 10) / 10)
    }
    addEventListener('deviceorientation', on)
    return () => removeEventListener('deviceorientation', on)
  }, [enabled])
  return roll
}

/** Fit a box of the given aspect inside the element. */
function useFit(ref, ratio, ready) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const W = el.clientWidth
      const H = el.clientHeight
      setSize(W / H > ratio ? { w: Math.round(H * ratio), h: H } : { w: W, h: Math.round(W / ratio) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, ratio, ready])
  return size
}

/** Mic level, rendered on its own so the meter doesn't re-render the whole screen. */
function Meter({ stream }) {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!stream) return
    let last = 0
    return audioMeter(stream, (v) => {
      const now = performance.now()
      if (now - last > 80) {
        last = now
        setLevel(v)
      }
    })
  }, [stream])
  return (
    <div className="meter" title="ระดับเสียง (แดง = ดังเกิน)">
      <i className={level > 0.9 ? 'hot' : ''} style={{ height: `${Math.min(100, level * 140)}%` }} />
    </div>
  )
}

function Slider({ label, ctl, value, onChange, fmt = (v) => v }) {
  if (!ctl) return null
  return (
    <div className="ctl">
      <span>{label}</span>
      <input type="range" min={ctl.min} max={ctl.max} step={ctl.step} value={value ?? ctl.value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="small">{fmt(value ?? ctl.value)}</span>
    </div>
  )
}

export default function Shoot({ id, start }) {
  const [project, update, flush] = useProject(id)
  const [settings, setSettings] = useSettings()
  const [sceneIdx, setSceneIdx] = useState(start)
  const scene = project?.scenes[sceneIdx]

  // camera
  const videoRef = useRef()
  const wrapRef = useRef()
  const [stream, setStream] = useState(null)
  const [camError, setCamError] = useState('')
  const [facing, setFacing] = useState('user')
  const [deviceId, setDeviceId] = useState('')
  const [micId, setMicId] = useState('')
  const [devices, setDevices] = useState({ cams: [], mics: [] })
  const [ctl, setCtl] = useState(null)
  const [vals, setVals] = useState({})
  const [focusRing, setFocusRing] = useState(null)

  // recording
  const recRef = useRef(null)
  const [phase, setPhase] = useState('idle') // idle | countdown | rec | saving
  const [count, setCount] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [rehearse, setRehearse] = useState(false)
  const [review, setReview] = useState(null) // { take, url }

  // prompter
  const [lineIdx, setLineIdx] = useState(0)
  const [heard, setHeard] = useState('')
  const cuesRef = useRef([])
  const [drawer, setDrawer] = useState(false)
  const [showDirection, setShowDirection] = useState(true)
  const [storage, setStorage] = useState(null)

  const sceneLines = scene?.lines ?? ''
  const lines = useMemo(() => prompterLines(sceneLines), [sceneLines])
  const running = phase === 'rec' || rehearse
  const ratio = project ? aspectRatio(project.aspect) : 9 / 16
  // Preview the whole camera frame (what the sensor really sees) and mark the
  // part that ends up in the clip; or preview only the cropped clip area.
  const [frame, setFrame] = useState(0)
  const fullFrame = settings.previewFull !== false && frame > 0
  const box = useFit(wrapRef, fullFrame ? frame : ratio, !!scene)
  const crop = fullFrame ? cropRect(frame, ratio) : { x: 0, y: 0, w: 1, h: 1 }
  const cropped = crop.w < 0.995 || crop.h < 0.995
  const roll = useLevel(settings.level)

  useWakeLock()
  useEffect(() => {
    storageInfo().then(setStorage)
  }, [phase])

  // Pick the camera the scene asks for when the scene changes.
  useEffect(() => {
    if (scene && !deviceId) setFacing(facingFor(scene))
    setLineIdx(0)
    setHeard('')
    setRehearse(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id])

  // Open / reopen the camera.
  useEffect(() => {
    if (!project) return
    let alive = true
    let s
    setCamError('')
    openCamera({ facing, deviceId, micId, resolution: settings.resolution, fps: settings.fps })
      .then(async (st) => {
        if (!alive) return stopStream(st)
        s = st
        setStream(st)
        const track = st.getVideoTracks()[0]
        setCtl(cameraControls(track))
        setVals({})
        const [cams, mics] = await Promise.all([listCameras(), listMics()])
        if (alive) setDevices({ cams, mics })
      })
      .catch((e) => alive && setCamError(e.message ?? String(e)))
    return () => {
      alive = false
      stopStream(s)
      setStream(null)
    }
  }, [!!project, facing, deviceId, micId, settings.resolution, settings.fps]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current
    if (!v || !stream) return
    v.srcObject = stream
    // Real frame shape; changes when the phone rotates or the camera switches.
    const measure = () => v.videoWidth && v.videoHeight && setFrame(v.videoWidth / v.videoHeight)
    v.addEventListener('loadedmetadata', measure)
    v.addEventListener('resize', measure)
    return () => {
      v.removeEventListener('loadedmetadata', measure)
      v.removeEventListener('resize', measure)
    }
  }, [stream])

  const track = stream?.getVideoTracks()[0]
  const mirror = facing === 'user' && !deviceId && settings.previewMirror !== false

  async function setVal(name, value) {
    setVals((v) => ({ ...v, [name]: value }))
    if (track) await setControl(track, name, value)
  }

  // ---------- prompter advance ----------

  const advance = useCallback(
    (d = 1) => {
      setLineIdx((i) => {
        const n = Math.max(0, Math.min(lines.length - 1, i + d))
        if (n !== i && recRef.current) cuesRef.current.push({ line: n, t: recRef.current.elapsed() })
        return n
      })
    },
    [lines.length],
  )

  // Auto-scroll: hold each line for as long as it takes to say it.
  useEffect(() => {
    if (!running || settings.prompterMode !== 'auto' || lineIdx >= lines.length - 1) return
    const ms = (speakSeconds(lines[lineIdx], settings.wpm) + 0.35) * 1000
    const t = setTimeout(() => advance(1), ms)
    return () => clearTimeout(t)
  }, [running, settings.prompterMode, settings.wpm, lineIdx, lines, advance])

  // Voice-follow.
  const lineRef = useRef('')
  lineRef.current = lines[lineIdx] ?? ''
  useEffect(() => {
    if (!running || settings.prompterMode !== 'voice' || !lines.length) return
    const f = followVoice({ getLine: () => lineRef.current, onAdvance: () => advance(1), onHeard: setHeard })
    if (!f) toast('อุปกรณ์นี้ไม่รองรับการฟังเสียง ใช้โหมดเลื่อนอัตโนมัติแทน')
    return () => f?.stop()
  }, [running, settings.prompterMode, lines.length, advance])

  // Recording clock + b-roll auto stop.
  const tickRef = useRef()
  tickRef.current = () => {
    const e = recRef.current?.elapsed() ?? 0
    setElapsed(e)
    if (scene?.kind === 'broll' && settings.brollAutoStop !== false && e >= sceneSeconds(scene, settings.wpm) + 0.5) stopRec()
  }
  useEffect(() => {
    if (phase !== 'rec') return
    const t = setInterval(() => tickRef.current(), 200)
    return () => clearInterval(t)
  }, [phase])

  // ---------- record ----------

  async function startRec() {
    if (!stream || phase !== 'idle') return
    setRehearse(false)
    setLineIdx(0)
    setHeard('')
    for (let n = settings.countdown; n > 0; n--) {
      setPhase('countdown')
      setCount(n)
      await new Promise((r) => setTimeout(r, 1000))
    }
    try {
      recRef.current = startRecording(stream)
      cuesRef.current = [{ line: 0, t: 0 }]
      setElapsed(0)
      setPhase('rec')
      navigator.vibrate?.(40)
    } catch (e) {
      toast(e.message)
      setPhase('idle')
    }
  }

  async function stopRec() {
    const rec = recRef.current
    if (!rec || phase !== 'rec') return
    recRef.current = null
    setPhase('saving')
    navigator.vibrate?.([30, 60, 30])
    try {
      const { blob, mime, duration } = await rec.stop()
      const takeId = uid()
      await putMedia(takeId, blob)
      const [info, thumb] = await Promise.all([probeMedia(blob).catch(() => ({})), thumbnail(blob)])
      const n = project.takes.filter((t) => t.sceneId === scene.id).reduce((m, t) => Math.max(m, t.n), 0) + 1
      const take = {
        id: takeId,
        sceneId: scene.id,
        n,
        mime,
        size: blob.size,
        duration: info.duration > 0 ? info.duration : duration,
        width: info.width,
        height: info.height,
        cues: cuesRef.current,
        thumb,
        rating: null,
        best: false,
        createdAt: Date.now(),
      }
      update((p) => ({ ...p, takes: [...p.takes, take] }))
      setReview({ take, url: URL.createObjectURL(blob) })
    } catch (e) {
      toast(`บันทึกไม่สำเร็จ: ${e.message ?? e}`)
    } finally {
      setPhase('idle')
    }
  }

  function closeReview() {
    if (review) URL.revokeObjectURL(review.url)
    setReview(null)
  }

  function rate(rating) {
    const { take } = review
    update((p) => ({
      ...p,
      takes: p.takes.map((t) =>
        t.id === take.id ? { ...t, rating, best: rating === 'good' } : rating === 'good' && t.sceneId === take.sceneId ? { ...t, best: false } : t,
      ),
    }))
    closeReview()
    if (rating === 'good') nextScene()
  }

  async function discard() {
    const { take } = review
    update((p) => ({ ...p, takes: p.takes.filter((t) => t.id !== take.id) }))
    await deleteMedia(take.id)
    closeReview()
  }

  /** After approving a take: jump to the next scene that still needs one. */
  function nextScene() {
    const pending = project.scenes.map((_, i) => i).filter((i) => i !== sceneIdx && sceneStatus(project, project.scenes[i]) !== 'done')
    const next = pending.find((i) => i > sceneIdx) ?? pending[0]
    if (next !== undefined) setSceneIdx(next)
    else {
      toast('🎉 ถ่ายครบทุกฉากแล้ว! ไปตรวจเทคและส่งตัดต่อ', 4000)
      Promise.resolve(flush()).then(() => go('p', id, 'wrap'))
    }
  }

  // ---------- keys: space/enter = record, arrows/page = prompter (Bluetooth pedals & remotes) ----------

  const keyRef = useRef()
  keyRef.current = (e) => {
    if (e.target.closest?.('input, textarea, select') || review) return
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'MediaPlayPause') {
      e.preventDefault()
      phase === 'rec' ? stopRec() : startRec()
    } else if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) {
      e.preventDefault()
      advance(1)
    } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) {
      e.preventDefault()
      advance(-1)
    } else if (e.key === '+' || e.key === '=') setSettings((s) => ({ wpm: Math.min(320, s.wpm + 10) }))
    else if (e.key === '-') setSettings((s) => ({ wpm: Math.max(80, s.wpm - 10) }))
  }
  useEffect(() => {
    const k = (e) => keyRef.current(e)
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])

  // Stop a recording if the user leaves the page mid-take.
  useEffect(() => () => recRef.current?.stop().catch(() => {}), [])

  async function onStageTap(e) {
    if (e.target.closest('.prompter') || !track) return
    // iOS needs a gesture before it shares device orientation.
    if (settings.level && typeof DeviceOrientationEvent?.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().catch(() => {})
    }
    const r = e.currentTarget.getBoundingClientRect()
    let x = (e.clientX - r.left) / r.width
    let y = (e.clientY - r.top) / r.height
    setFocusRing({ x: x * 100, y: y * 100, k: Date.now() })
    if (!fullFrame && frame > 0) {
      // Cropped preview: map the tap back onto the full camera frame.
      const c = cropRect(frame, ratio)
      x = c.x + x * c.w
      y = c.y + y * c.h
    }
    if (mirror) x = 1 - x
    await focusAt(track, x, y)
  }

  if (project === undefined) return <div className="empty">กำลังโหลด…</div>
  if (!project || !project.scenes.length)
    return (
      <div className="page empty">
        ยังไม่มีฉากให้ถ่าย <a href={`#/p/${id}/plan`}>ไปวางบทก่อน</a>
      </div>
    )
  if (!scene) {
    setSceneIdx(0)
    return null
  }

  const target = sceneSeconds(scene, settings.wpm)
  const over = phase === 'rec' && elapsed > target * 1.3 + 1
  const done = project.scenes.filter((s) => sceneStatus(project, s) === 'done').length
  const levelOk = roll !== null && Math.abs(roll) < 1.5

  // Teleprompter: a band above the picture (whole frame stays visible) or,
  // optionally, laid over the top of the picture for a bigger preview.
  const overlay = settings.prompterOverlay === true
  const prompterEl = (
    <div
      className={`prompter ${overlay ? 'over' : 'band'} ${settings.prompterMirror ? 'mirror' : ''}`}
      style={{ fontSize: overlay ? settings.prompterSize : Math.min(settings.prompterSize, 30) }}
      onClick={() => settings.prompterMode === 'manual' && advance(1)}
    >
      {scene.kind === 'broll' || !lines.length ? (
        <div className="direction" style={{ fontSize: '1.05rem' }}>
          🎥 {scene.direction || 'ถ่ายภาพประกอบ'} · {fmtTime(target)}
        </div>
      ) : (
        <>
          {overlay && lineIdx > 0 && <div className="line past">{lines[lineIdx - 1]}</div>}
          <div className="line now">{lines[lineIdx]}</div>
          {lines[lineIdx + 1] && <div className="line next">{lines[lineIdx + 1]}</div>}
          {settings.prompterMode === 'voice' && running && heard && <div className="heard">🎙 {heard.slice(-40)}</div>}
        </>
      )}
    </div>
  )
  const recording = phase === 'rec' || phase === 'countdown'

  return (
    <div className="shoot">
      <div className="shoot-top">
        <button className="icon" aria-label="ออก" disabled={phase === 'rec'} onClick={() => go('p', id, 'plan', 'script')}>
          ✕
        </button>
        <div className="scene-title">
          {sceneIdx + 1}/{project.scenes.length} · {scene.title}
        </div>
        <span className={`pill ${phase === 'rec' ? 'rec' : ''}`} style={over ? { background: 'var(--warn)', color: '#000' } : undefined}>
          {phase === 'rec' ? '● ' : ''}
          {fmtTime(elapsed)} / {fmtTime(target)}
        </span>
        <button className="icon" aria-label="ตั้งค่ากล้อง" onClick={() => setDrawer((d) => !d)}>
          🎛
        </button>
      </div>

      {!overlay && prompterEl}
      <div className="shoot-stage-wrap" ref={wrapRef}>
        <div className="stage" style={{ width: box.w, height: box.h }} onClick={onStageTap}>
          <video ref={videoRef} className={mirror ? 'mirror' : ''} style={{ objectFit: fullFrame ? 'contain' : 'cover' }} autoPlay playsInline muted />
          {/* Guides live inside the area that ends up in the clip. */}
          <div
            className={`crop-area ${cropped ? 'cropped' : ''}`}
            style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
          >
            {cropped && <span className="crop-label">ในคลิป {project.aspect}</span>}
            {settings.grid && <div className="overlay grid-lines" />}
            {settings.safeZone && ratio < 1 && <div className="safe-zone" />}
            {settings.level && roll !== null && (
              <div className={`level ${levelOk ? 'ok' : ''}`} style={{ transform: `translate(-50%, 0) rotate(${-roll}deg)` }} />
            )}
          </div>
          {zoomStops(ctl?.zoom).length > 0 && (
            <div className="zoom-stops" onClick={(e) => e.stopPropagation()}>
              {zoomStops(ctl.zoom).map((z) => (
                <button key={z} className={Math.abs((vals.zoom ?? ctl.zoom.value) - z) < 0.05 ? 'on' : ''} onClick={() => setVal('zoom', z)}>
                  {z < 1 ? z.toFixed(1).replace(/^0/, '') : z}×
                </button>
              ))}
            </div>
          )}
          {focusRing && <div key={focusRing.k} className="focus-ring" style={{ left: `${focusRing.x}%`, top: `${focusRing.y}%` }} />}
          <Meter stream={stream} />

          {phase === 'countdown' && <div className="countdown">{count}</div>}
          {camError && (
            <div className="countdown" style={{ fontSize: '1rem', padding: 24, pointerEvents: 'auto' }}>
              <div className="notice err stack">
                {camError}
                <button onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>ลองกล้องอีกตัว</button>
              </div>
            </div>
          )}
        </div>

        {overlay && prompterEl}

        {drawer && (
          <div className="drawer">
            <div className="row">
              <strong className="grow">คุมกล้อง & บท</strong>
              <button className="icon ghost" onClick={() => setDrawer(false)} aria-label="ปิด">
                ✕
              </button>
            </div>
            <div className="grid2">
              <label className="field">
                กล้อง
                <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={phase === 'rec'}>
                  <option value="">อัตโนมัติ ({facing === 'user' ? 'หน้า' : 'หลัง'})</option>
                  {devices.cams.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `กล้อง ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                ไมโครโฟน
                <select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={phase === 'rec'}>
                  <option value="">ค่าเริ่มต้น</option>
                  {devices.mics.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `ไมค์ ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                ความละเอียด
                <select value={settings.resolution} onChange={(e) => setSettings({ resolution: e.target.value })} disabled={phase === 'rec'}>
                  <option value="720">HD 720p</option>
                  <option value="1080">Full HD 1080p</option>
                  <option value="2160">4K (ถ้ากล้องรองรับ)</option>
                </select>
              </label>
              <label className="field">
                เฟรมเรต
                <select value={settings.fps} onChange={(e) => setSettings({ fps: Number(e.target.value) })} disabled={phase === 'rec'}>
                  <option value={24}>24 fps (ภาพยนตร์)</option>
                  <option value={30}>30 fps (มาตรฐาน)</option>
                  <option value={60}>60 fps (ลื่น/สโลว์)</option>
                </select>
              </label>
            </div>
            {ctl?.settings?.width && (
              <div className="small muted">
                ได้จริง: {ctl.settings.width}×{ctl.settings.height} · {Math.round(ctl.settings.frameRate ?? 0)} fps
                {cropped && ` · กรอบประคือส่วนที่อยู่ในคลิป ${project.aspect} (หมุนมือถือหรือเปลี่ยนสัดส่วนโปรเจคเพื่อใช้ภาพเต็มเฟรม)`}
              </div>
            )}
            <Slider label="ซูม" ctl={ctl?.zoom} value={vals.zoom} onChange={(v) => setVal('zoom', v)} fmt={(v) => `${(+v).toFixed(1)}x`} />
            <Slider label="ความสว่าง" ctl={ctl?.exposure} value={vals.exposureCompensation} onChange={(v) => setVal('exposureCompensation', v)} fmt={(v) => (+v).toFixed(1)} />
            {ctl?.focusModes?.length > 0 && (
              <div className="ctl">
                <span>โฟกัส</span>
                <select value={vals.focusMode ?? ''} onChange={(e) => setVal('focusMode', e.target.value)}>
                  <option value="">อัตโนมัติ</option>
                  {ctl.focusModes.map((m) => (
                    <option key={m} value={m}>
                      {{ continuous: 'ต่อเนื่อง', manual: 'แมนนวล (ล็อก)', 'single-shot': 'ครั้งเดียว' }[m] ?? m}
                    </option>
                  ))}
                </select>
                <span />
              </div>
            )}
            {vals.focusMode === 'manual' && (
              <Slider label="ระยะโฟกัส" ctl={ctl?.focusDistance} value={vals.focusDistance} onChange={(v) => setVal('focusDistance', v)} fmt={(v) => (+v).toFixed(2)} />
            )}
            {ctl?.whiteBalanceModes?.length > 0 && (
              <div className="ctl">
                <span>สมดุลแสงขาว</span>
                <select value={vals.whiteBalanceMode ?? ''} onChange={(e) => setVal('whiteBalanceMode', e.target.value)}>
                  <option value="">อัตโนมัติ</option>
                  {ctl.whiteBalanceModes.map((m) => (
                    <option key={m} value={m}>
                      {{ continuous: 'อัตโนมัติต่อเนื่อง', manual: 'ล็อกอุณหภูมิสี' }[m] ?? m}
                    </option>
                  ))}
                </select>
                <span />
              </div>
            )}
            {vals.whiteBalanceMode === 'manual' && (
              <Slider label="อุณหภูมิสี" ctl={ctl?.colorTemperature} value={vals.colorTemperature} onChange={(v) => setVal('colorTemperature', v)} fmt={(v) => `${Math.round(v)}K`} />
            )}
            {ctl && !ctl.zoom && !ctl.exposure && !ctl.focusModes.length && (
              <div className="small muted">กล้องนี้ไม่เปิดให้ปรับซูม/แสง/โฟกัสผ่านเบราว์เซอร์ (ปกติของเว็บแคมและ iPhone บางรุ่น) — แตะที่ภาพเพื่อโฟกัสถ้ารองรับ</div>
            )}
            <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
            <div className="row">
              <span className="grow">บทเลื่อนแบบ</span>
              {[
                ['auto', 'อัตโนมัติ'],
                ['voice', 'ตามเสียง'],
                ['manual', 'แตะเอง'],
              ].map(([m, label]) => (
                <button key={m} className={settings.prompterMode === m ? 'on' : ''} disabled={m === 'voice' && !speechSupported()} onClick={() => setSettings({ prompterMode: m })}>
                  {label}
                </button>
              ))}
            </div>
            <div className="ctl">
              <span>ความเร็วพูด</span>
              <input type="range" min="80" max="320" step="10" value={settings.wpm} onChange={(e) => setSettings({ wpm: Number(e.target.value) })} />
              <span className="small">{settings.wpm}</span>
            </div>
            <div className="ctl">
              <span>ขนาดตัวบท</span>
              <input type="range" min="20" max="64" value={settings.prompterSize} onChange={(e) => setSettings({ prompterSize: Number(e.target.value) })} />
              <span className="small">{settings.prompterSize}</span>
            </div>
            <div className="chips">
              {[
                ['grid', 'เส้นกริด 3×3'],
                ['level', 'วัดระดับ'],
                ['safeZone', 'พื้นที่ปลอดภัย UI'],
                ['previewFull', 'เห็นเต็มเฟรมกล้อง'],
                ['previewMirror', 'กลับด้านภาพกล้องหน้า'],
                ['prompterOverlay', 'บทซ้อนบนภาพ (ภาพใหญ่ขึ้น)'],
                ['prompterMirror', 'กลับด้านบท (กระจก prompter)'],
                ['brollAutoStop', 'หยุด B-roll อัตโนมัติ'],
              ].map(([k, label]) => (
                <label key={k} className="check chip">
                  <input type="checkbox" checked={settings[k] !== false} onChange={(e) => setSettings({ [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
              <label className="check chip">
                นับถอยหลัง
                <select style={{ width: 'auto', minHeight: 30, padding: '2px 6px' }} value={settings.countdown} onChange={(e) => setSettings({ countdown: Number(e.target.value) })}>
                  <option value={0}>ไม่นับ</option>
                  <option value={3}>3 วิ</option>
                  <option value={5}>5 วิ</option>
                  <option value={10}>10 วิ</option>
                </select>
              </label>
            </div>
            <div className="small muted">
              คีย์ลัด/รีโมตบลูทูธ: <b>Space/Enter</b> อัด-หยุด · <b>↓ / PageDown</b> บรรทัดถัดไป · <b>↑</b> ย้อน · <b>+ −</b> ความเร็ว
            </div>
          </div>
        )}
      </div>

      <div className="shoot-bottom">
        {showDirection && !recording && (
          <div className="small" onClick={() => setShowDirection(false)} style={{ color: '#ddd' }}>
            🎬 <b>{scene.shot.size}</b> {SHOT_SIZES[scene.shot.size]?.split(' (')[0]} · {ANGLES[scene.shot.angle]} · {MOVES[scene.shot.move]} · กล้อง
            {scene.shot.camera === 'back' ? 'หลัง' : 'หน้า'}
            {scene.direction && scene.kind === 'talk' && <> — {scene.direction}</>}
            <span className="muted"> · {SHOT_TIPS[scene.shot.size]}</span>
          </div>
        )}
        <div className="scene-strip" hidden={recording}>
          {project.scenes.map((s, i) => {
            const st = sceneStatus(project, s)
            return (
              <button key={s.id} className={`${i === sceneIdx ? 'cur' : ''} ${st === 'done' ? 'done' : ''}`} disabled={phase !== 'idle'} onClick={() => setSceneIdx(i)}>
                {st === 'done' ? '✓' : i + 1} {s.title.slice(0, 14)}
              </button>
            )
          })}
        </div>
        <div className="shoot-controls">
          <div className="side">
            <button
              className="icon"
              aria-label="สลับกล้อง"
              disabled={phase !== 'idle'}
              onClick={() => {
                setDeviceId('')
                setFacing((f) => (f === 'user' ? 'environment' : 'user'))
              }}
            >
              🔄
            </button>
            {ctl?.torch && (
              <button className={`icon ${vals.torch ? 'on' : ''}`} aria-label="ไฟแฟลช" onClick={() => setVal('torch', !vals.torch)}>
                🔦
              </button>
            )}
            {scene.kind === 'talk' && lines.length > 0 && (
              <button className={`${rehearse ? 'on' : ''}`} disabled={phase !== 'idle'} onClick={() => (setLineIdx(0), setRehearse((r) => !r))}>
                {rehearse ? 'หยุดซ้อม' : 'ซ้อม'}
              </button>
            )}
          </div>
          <button
            className={`rec-btn ${phase === 'rec' ? 'on' : ''}`}
            aria-label={phase === 'rec' ? 'หยุดอัด' : 'เริ่มอัด'}
            disabled={!stream || phase === 'saving' || phase === 'countdown'}
            onClick={() => (phase === 'rec' ? stopRec() : startRec())}
          />
          <div className="side right">
            {lines.length > 1 && (
              <>
                <button className="icon" aria-label="บรรทัดก่อน" onClick={() => advance(-1)}>
                  ▲
                </button>
                <button className="icon" aria-label="บรรทัดถัดไป" onClick={() => advance(1)}>
                  ▼
                </button>
              </>
            )}
            <button className="icon" aria-label="ฉากถัดไป" disabled={phase !== 'idle'} onClick={() => setSceneIdx((sceneIdx + 1) % project.scenes.length)}>
              ⏭
            </button>
          </div>
        </div>
        <div className="row small muted" style={{ justifyContent: 'space-between' }} hidden={recording}>
          <span>
            ถ่ายแล้ว {done}/{project.scenes.length} ฉาก · {project.takes.filter((t) => t.sceneId === scene.id).length} เทคในฉากนี้
          </span>
          {storage && <span>เหลือ {fmtBytes(Math.max(0, storage.quota - storage.used))}</span>}
          <a href={`#/p/${id}/wrap`} onClick={() => flush()}>
            ตรวจเทค →
          </a>
        </div>
      </div>

      {phase === 'saving' && <div className="toast">กำลังบันทึกเทค…</div>}

      {review && (
        <Modal onClose={closeReview}>
          <div className="row">
            <strong className="grow">
              ฉาก {sceneIdx + 1} · เทค {review.take.n} · {fmtTime(review.take.duration)}
            </strong>
          </div>
          <video src={review.url} controls autoPlay playsInline />
          <button className="primary big" onClick={() => rate('good')}>
            ✓ ใช้เทคนี้ → ไปฉากถัดไป
          </button>
          <div className="row">
            <button className="grow" onClick={() => rate(null)}>
              ↻ อัดอีกเทค (เก็บเทคนี้ไว้)
            </button>
            <button className="danger" onClick={discard}>
              ✗ ทิ้ง
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
