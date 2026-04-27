/**
 * gen-screenshots.mjs
 * Captures screenshots of the simulator using Puppeteer.
 * Usage:  npm run screenshots
 * Output: ../screenshots/
 */
import puppeteer from 'puppeteer'
import { spawn }  from 'child_process'
import { mkdir }  from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 4174
const BASE = `http://localhost:${PORT}`
const OUT  = path.join(__dirname, '..', 'screenshots')

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitForServer(url, ms = 20000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return } catch {}
    await sleep(250)
  }
  throw new Error(`Server not ready after ${ms}ms`)
}

async function loadExample(page, category, name) {
  await page.click('.exmenu-trigger')
  await sleep(400)
  const cats = await page.$$('.exmenu-cat')
  for (const cat of cats) {
    const txt = await cat.evaluate(el => el.querySelector('span')?.textContent ?? '')
    if (txt.trim() === category) { await cat.hover(); await sleep(350); break }
  }
  const items = await page.$$('.exmenu-sub-item')
  for (const item of items) {
    const txt = await item.evaluate(el => el.textContent.trim())
    if (txt === name) { await item.click(); await sleep(500); return }
  }
  throw new Error(`Example "${category} / ${name}" not found`)
}

async function build(page) {
  await page.click('.btn-asm')
  await sleep(800)
}

async function setSpeed(page, index) {
  // Focus the range slider then press Home (min) and arrow right to target index
  await page.focus('.speed-slider')
  await page.keyboard.press('Home')
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowRight')
  await sleep(150)
}

async function run(page) {
  await page.click('.btn-run')
}

async function stop(page) {
  const btn = await page.$('.btn-stop')
  if (btn) { await btn.click(); await sleep(400) }
}

// ── Shot 01: LED Count ────────────────────────────────────────────────────
async function shot01_ledCount(page) {
  console.log('  Shot 01 — LED Count…')
  await loadExample(page, 'I/O', 'LED Count')
  await build(page)
  await setSpeed(page, 4)   // Turbo
  await run(page)
  await sleep(3000)         // let counter advance
  await stop(page)
  await page.screenshot({ path: path.join(OUT, '01-led-count.png') })
  console.log('  Saved: 01-led-count.png')
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(OUT)) await mkdir(OUT, { recursive: true })

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
    cwd: __dirname, shell: true, stdio: 'pipe'
  })
  process.on('exit', () => server.kill())

  try {
    console.log('Starting preview server…')
    await waitForServer(BASE)
    console.log('Server ready.')

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })

    // Suppress welcome modal via localStorage before page scripts run
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sim8085_welcomed', '1')
    })

    await page.goto(BASE, { waitUntil: 'networkidle0' })
    await sleep(600)
    console.log('App loaded.')

    await shot01_ledCount(page)

    await browser.close()
  } finally {
    server.kill()
  }

  console.log(`\nDone. Screenshots written to: ${OUT}`)
}

main().catch(err => { console.error(err); process.exit(1) })
