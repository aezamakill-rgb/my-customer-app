// Camera access + pro controls through MediaStreamTrack capabilities.
// Every control is feature-detected: phones expose zoom/torch/focus/exposure,
// most laptops expose few or none.

const LONG_SIDE = { 720: 1280, 1080: 1920, 2160: 3840 }

export function aspectRatio(aspect) {
  const [w, h] = aspect.split(':').map(Number)
  return w / h
}

export async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'videoinput')
  } catch {
    return []
  }
}

export async function listMics() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'audioinput')
  } catch {
    return []
  }
}

/**
 * Open camera + mic. Portrait projects ask for a portrait frame; phones
 * rotate the sensor for us, desktops fall back to the nearest mode.
 */
export async function openCamera({ facing = 'user', deviceId, micId, resolution = '1080', fps = 30, aspect = '9:16' }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับกล้อง หรือไม่ได้เปิดผ่าน https')
  }
  const long = LONG_SIDE[resolution] ?? 1920
  const short = Math.round((long * 9) / 16)
  const portrait = aspectRatio(aspect) < 1
  const video = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }),
    width: { ideal: portrait ? short : long },
    height: { ideal: portrait ? long : short },
    frameRate: { ideal: fps },
  }
  const audio = {
    ...(micId && { deviceId: { exact: micId } }),
    echoCancellation: false, // voice for video sounds more natural without it
    noiseSuppression: true,
    autoGainControl: true,
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio })
  } catch (e) {
    if (e?.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId } : { facingMode: facing }, audio: true })
    }
    if (e?.name === 'NotAllowedError') throw new Error('ไม่ได้รับอนุญาตให้ใช้กล้อง/ไมค์ — เปิดสิทธิ์ในการตั้งค่าเบราว์เซอร์แล้วลองใหม่')
    if (e?.name === 'NotFoundError') throw new Error('ไม่พบกล้องหรือไมโครโฟนในอุปกรณ์นี้')
    if (e?.name === 'NotReadableError') throw new Error('กล้องถูกแอปอื่นใช้อยู่ ปิดแอปนั้นแล้วลองใหม่')
    throw e
  }
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop())
}

/** Which pro controls this camera supports, with their ranges. */
export function cameraControls(track) {
  const caps = track?.getCapabilities?.() ?? {}
  const settings = track?.getSettings?.() ?? {}
  const range = (name) =>
    caps[name] && typeof caps[name].max === 'number' && caps[name].max > caps[name].min
      ? { min: caps[name].min, max: caps[name].max, step: caps[name].step || (caps[name].max - caps[name].min) / 100, value: settings[name] ?? caps[name].min }
      : null
  return {
    zoom: range('zoom'),
    exposure: range('exposureCompensation'),
    focusDistance: range('focusDistance'),
    colorTemperature: range('colorTemperature'),
    torch: caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true)),
    focusModes: caps.focusMode ?? [],
    whiteBalanceModes: caps.whiteBalanceMode ?? [],
    exposureModes: caps.exposureMode ?? [],
    pointsOfInterest: 'pointsOfInterest' in caps,
    settings,
  }
}

export async function setControl(track, name, value) {
  try {
    await track.applyConstraints({ advanced: [{ [name]: value }] })
    return true
  } catch {
    return false
  }
}

/** Tap to focus/meter at a point (0..1 in both axes) where supported. */
export async function focusAt(track, x, y) {
  const c = cameraControls(track)
  const adv = {}
  if (c.pointsOfInterest) adv.pointsOfInterest = [{ x, y }]
  if (c.focusModes.includes('single-shot')) adv.focusMode = 'single-shot'
  else if (c.focusModes.includes('continuous')) adv.focusMode = 'continuous'
  if (c.exposureModes.includes('continuous')) adv.exposureMode = 'continuous'
  if (!Object.keys(adv).length) return false
  try {
    await track.applyConstraints({ advanced: [adv] })
    return true
  } catch {
    return false
  }
}

// ---------- audio level meter ----------

export function audioMeter(stream, onLevel) {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AC || !stream.getAudioTracks().length) return () => {}
  const ctx = new AC()
  const src = ctx.createMediaStreamSource(stream)
  const an = ctx.createAnalyser()
  an.fftSize = 1024
  src.connect(an)
  const buf = new Float32Array(an.fftSize)
  let raf
  const tick = () => {
    an.getFloatTimeDomainData(buf)
    let peak = 0
    for (const v of buf) peak = Math.max(peak, Math.abs(v))
    onLevel(peak)
    raf = requestAnimationFrame(tick)
  }
  tick()
  // iOS starts AudioContexts suspended until a user gesture.
  const resume = () => ctx.state === 'suspended' && ctx.resume().catch(() => {})
  document.addEventListener('pointerdown', resume)
  return () => {
    cancelAnimationFrame(raf)
    document.removeEventListener('pointerdown', resume)
    src.disconnect()
    ctx.close().catch(() => {})
  }
}
