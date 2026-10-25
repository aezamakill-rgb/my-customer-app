// End-to-end check with a fake camera: plan → shoot 2 takes → send to KinCut
// → open KinCut (served from the same origin) and confirm the project loads.
//   node scripts/e2e.cjs <path-to-kincut-build> [screenshot-dir]
const { chromium } = require('playwright')
const http = require('http')
const fs = require('fs')
const path = require('path')

const KINCUT = path.resolve(process.argv[2] ?? '../kincut')
const SHOTS = path.resolve(process.argv[3] ?? 'e2e-shots')
const DIST = path.resolve('dist')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.cube': 'text/plain' }

function serve(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0])
      const [root, rel] = url.startsWith('/kincut/') ? [KINCUT, url.slice(8)] : url.startsWith('/kinshot/') ? [DIST, url.slice(9)] : [null]
      if (!root) return res.writeHead(404).end()
      let file = path.join(root, rel || 'index.html')
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' })
      fs.createReadStream(file).pipe(res)
    })
    server.listen(port, () => resolve(server))
  })
}

;(async () => {
  fs.mkdirSync(SHOTS, { recursive: true })
  const port = 4199
  const server = await serve(port)
  const origin = `http://localhost:${port}`
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript((kincutUrl) => {
    if (location.pathname.startsWith('/kinshot/') && !localStorage.getItem('kinshot.settings'))
      localStorage.setItem('kinshot.settings', JSON.stringify({ countdown: 0, kincutUrl }))
  }, `${origin}/kincut/`)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) })
  const step = (s) => console.log('•', s)

  step('home')
  await page.goto(`${origin}/kinshot/`)
  await page.getByRole('button', { name: /เริ่มคอนเทนต์ใหม่/ }).click()
  await page.getByPlaceholder('เช่น รีวิวกล้องมือถือ').fill('หูฟังไร้สาย รุ่น X')
  await shot('01-new')
  await page.getByRole('button', { name: /รีวิวสินค้า/ }).click()
  await page.getByText('บท & ช็อต').first().waitFor()
  await shot('02-script')

  step('team tab: one-shot send → resume → auto pick-up from clipboard')
  await page.getByRole('tab', { name: /ทีม AI/ }).click()
  const popup = ctx.waitForEvent('page')
  await page.getByRole('button', { name: /ส่งให้ Gemini/ }).first().click()
  await (await popup).close()
  await page.getByText(/รอคำตอบจาก Gemini/).waitFor()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  if (!copied.includes('นักรีเสิร์ช')) throw new Error('prompt was not copied')
  await shot('03-waiting')
  // The phone closed KinShot while the user was in the AI app: a fresh launch resumes the waiting step.
  const relaunch = await ctx.newPage()
  await relaunch.goto(`${origin}/kinshot/`)
  await relaunch.getByText(/รอคำตอบจาก Gemini/).waitFor()
  await relaunch.close()
  const answer = 'ได้เลยครับ\n```json\n' + JSON.stringify({ title: 'หูฟัง X ใช้จริง 7 วัน', research: 'สรุปรีเสิร์ช', hook_options: ['หูฟังพันบาทที่เสียงดีกว่าหมื่น?'], scenes: [
    { title: 'Hook', kind: 'talk', lines: ['หูฟังพันบาท', 'เสียงดีกว่าหมื่นจริงไหม'], shot: { size: 'CU', angle: 'eye', move: 'pushin', camera: 'front' }, direction: 'ถือหูฟังข้างหน้า' },
    { title: 'แกะกล่อง', kind: 'broll', lines: [], shot: { size: 'TOP', angle: 'high', move: 'static', camera: 'back' }, direction: 'แกะกล่องช้าๆ', seconds: 2 },
  ], caption: 'ใช้จริง 7 วัน', hashtags: ['#รีวิว'], notes: ['ใส่เสียงว้าวตอนเปิดกล่อง'] }) + '\n```'
  await page.evaluate((t) => navigator.clipboard.writeText(t), answer)
  await page.evaluate(() => dispatchEvent(new Event('focus')))
  await page.getByText('ทางเลือก Hook').waitFor()
  await shot('03-team-applied')

  step('shoot scene 1')
  await page.getByRole('button', { name: '🎥 เริ่มถ่าย' }).click()
  await page.locator('video').first().waitFor()
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
  await page.waitForTimeout(500)
  await shot('04-shoot')
  await page.getByRole('button', { name: 'เริ่มอัด' }).click()
  await page.waitForTimeout(2600)
  await shot('05-recording')
  await page.getByRole('button', { name: 'หยุดอัด' }).click()
  await page.getByText('ใช้เทคนี้').waitFor({ timeout: 20000 })
  await shot('06-review')
  await page.getByRole('button', { name: /ใช้เทคนี้/ }).click()

  step('shoot scene 2 (b-roll auto stop)')
  await page.getByText('2/2').waitFor()
  await page.getByRole('button', { name: 'เริ่มอัด' }).click()
  await page.getByText('ใช้เทคนี้').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /ใช้เทคนี้/ }).click()
  await page.getByText('ตรวจเทค & ส่งตัดต่อ').first().waitFor()
  await page.getByText('ถ่ายแล้ว 2/2 ฉาก').waitFor()
  await shot('07-wrap')

  step('send to KinCut')
  await page.getByRole('button', { name: /ส่งเข้า KinCut/ }).click()
  await page.getByText(/เปิด KinCut → โปรเจค/).waitFor({ timeout: 30000 })
  await shot('08-sent')
  const opfs = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const projects = await root.getDirectoryHandle('projects')
    const out = []
    for await (const [name, h] of projects) out.push(JSON.parse(await (await h.getFile()).text()))
    return out
  })
  const kc = opfs.find((p) => p.name === 'หูฟังไร้สาย รุ่น X')
  if (!kc) throw new Error('KinCut project not written')
  console.log('  KinCut project:', JSON.stringify({ clips: kc.clips.length, assets: kc.assets.map((a) => [a.mime, +a.duration.toFixed(2), a.width, a.height, a.hasAudio]), texts: kc.texts.map((t) => [t.text, +t.start.toFixed(2), +t.end.toFixed(2)]) }))

  step('open KinCut')
  await page.goto(`${origin}/kincut/`)
  await page.getByText('หูฟังไร้สาย รุ่น X').waitFor({ timeout: 20000 })
  await shot('09-kincut-home')
  await page.getByText('หูฟังไร้สาย รุ่น X').click()
  await page.waitForTimeout(4000)
  await shot('10-kincut-editor')

  const relevant = errors.filter((e) => !/favicon|404/.test(e))
  console.log(relevant.length ? `ERRORS:\n${relevant.join('\n')}` : 'no page errors')
  await browser.close()
  server.close()
  process.exit(relevant.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
