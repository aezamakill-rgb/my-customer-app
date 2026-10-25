// Renders public/favicon.svg to the PNG icons the PWA manifest needs.
const { chromium } = require('playwright')
const fs = require('fs')
;(async () => {
  const svg = fs.readFileSync('public/favicon.svg', 'utf8')
  const b = await chromium.launch()
  const p = await b.newPage()
  for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['maskable-512', 512, 0.12]]) {
    await p.setViewportSize({ width: size, height: size })
    const inner = Math.round(size * (1 - pad * 2))
    await p.setContent(`<body style="margin:0;background:#0e0f13;display:grid;place-items:center;width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body>`)
    await p.screenshot({ path: `public/icons/${name}.png`, omitBackground: false })
  }
  await b.close()
})()
