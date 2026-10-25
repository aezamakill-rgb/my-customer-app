// MediaRecorder wrapper. Prefers H.264/AAC MP4 (opens everywhere: KinCut,
// CapCut, Premiere, iPhone Photos); falls back to WebM where MP4 recording
// isn't available (Firefox, older Chrome).

const CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null
  return CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? ''
}

export const extFor = (mime) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm')

export function bitrateFor(height) {
  const h = Math.min(height, 2160)
  if (h >= 2000) return 35_000_000
  if (h >= 1000) return 12_000_000
  return 6_000_000
}

/**
 * Start recording `stream`. Returns a controller whose `stop()` resolves to
 * `{ blob, mime, duration }` with the wall-clock duration in seconds.
 */
export function startRecording(stream) {
  if (typeof MediaRecorder === 'undefined') throw new Error('เบราว์เซอร์นี้อัดวิดีโอไม่ได้ (ไม่มี MediaRecorder)')
  const mime = pickMime()
  const s = stream.getVideoTracks()[0]?.getSettings?.() ?? {}
  const shortSide = Math.min(s.width ?? 1080, s.height ?? 1920)
  const rec = new MediaRecorder(stream, {
    ...(mime && { mimeType: mime }),
    videoBitsPerSecond: bitrateFor(shortSide),
    audioBitsPerSecond: 192_000,
  })
  const chunks = []
  rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data)
  const t0 = performance.now()
  let pausedAt = 0
  let pausedTotal = 0
  rec.start(1000)
  const elapsed = () => (performance.now() - t0 - pausedTotal - (pausedAt ? performance.now() - pausedAt : 0)) / 1000
  return {
    recorder: rec,
    elapsed,
    pause() {
      if (rec.state === 'recording') {
        rec.pause()
        pausedAt = performance.now()
      }
    },
    resume() {
      if (rec.state === 'paused') {
        rec.resume()
        pausedTotal += performance.now() - pausedAt
        pausedAt = 0
      }
    },
    stop() {
      return new Promise((resolve, reject) => {
        const duration = elapsed()
        rec.onstop = () => {
          const type = rec.mimeType || mime || chunks[0]?.type || 'video/webm'
          resolve({ blob: new Blob(chunks, { type }), mime: type, duration })
        }
        rec.onerror = (e) => reject(e.error ?? new Error('Recording failed'))
        if (rec.state === 'inactive') rec.onstop()
        else rec.stop()
      })
    },
  }
}

/**
 * Exact duration/size from the file itself (MediaRecorder WebM files have
 * no duration header). Uses the same demuxer as KinCut.
 */
export async function probeMedia(blob) {
  const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    return {
      duration: await input.computeDuration(),
      width: video?.displayWidth,
      height: video?.displayHeight,
      hasAudio: !!audio,
    }
  } finally {
    input.dispose?.()
  }
}

/** Small JPEG thumbnail from the first frame of a recorded take. */
export function thumbnail(blob, at = 0.3) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    const done = (val) => {
      URL.revokeObjectURL(url)
      resolve(val)
    }
    v.onloadeddata = () => {
      v.currentTime = Math.min(at, (Number.isFinite(v.duration) ? v.duration : 1) / 2)
    }
    v.onseeked = () => {
      try {
        const scale = 160 / Math.max(v.videoWidth, v.videoHeight)
        const c = document.createElement('canvas')
        c.width = Math.round(v.videoWidth * scale)
        c.height = Math.round(v.videoHeight * scale)
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        done(c.toDataURL('image/jpeg', 0.6))
      } catch {
        done(null)
      }
    }
    v.onerror = () => done(null)
    setTimeout(() => done(null), 5000)
    v.src = url
  })
}
