/**
 * gen-gifs.mjs
 * Captures animated GIFs of the simulator using Puppeteer.
 * Usage:  npm run gifs
 * Output: ../screenshots/
 */
import puppeteer    from 'puppeteer'
import GifEncoder   from 'gif-encoder-2'
import { PNG }      from 'pngjs'
import { spawn }    from 'child_process'
import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path         from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 4176
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

async function getRect(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, selector)
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
    if (txt === name) { await item.click(); await sleep(600); return }
  }
  throw new Error(`Example "${category} / ${name}" not found`)
}

async function assemble(page) {
  await page.click('.btn-asm')
  await sleep(800)
}

async function setSpeed(page, index) {
  await page.focus('.speed-slider')
  await page.keyboard.press('Home')
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowRight')
  await sleep(150)
}

// ── GIF encoding ─────────────────────────────────────────────────────────────

async function encodeGif(frames, w, h, frameDelayMs, filename) {
  const enc = new GifEncoder(w, h, 'octree', true, frames.length)
  enc.setDelay(frameDelayMs)
  enc.setRepeat(0)
  enc.start()
  for (const buf of frames) {
    const png = PNG.sync.read(buf)
    enc.addFrame(png.data)
  }
  enc.finish()
  const gifPath = path.join(OUT, filename)
  await writeFile(gifPath, enc.out.getData())
  console.log(`  Saved: ${filename}  (${frames.length} frames @ ${frameDelayMs}ms)`)
}

async function captureFrames(page, clip, count, intervalMs) {
  const frames = []
  for (let i = 0; i < count; i++) {
    frames.push(await page.screenshot({ clip }))
    if (i < count - 1) await sleep(intervalMs)
  }
  return frames
}

function roundClip(r, pad = 0) {
  return {
    x: Math.round(r.x - pad),
    y: Math.round(r.y - pad),
    width:  Math.round(r.w + pad * 2),
    height: Math.round(r.h + pad * 2),
  }
}

// ── GIF 01: Turbo LED counter ─────────────────────────────────────────────────
async function gif01_turboLed(page) {
  console.log('  GIF 01 — Turbo LED counter…')
  await loadExample(page, 'I/O', 'LED Count')
  await assemble(page)
  await setSpeed(page, 4)  // Turbo

  await page.click('.btn-run')
  await sleep(800)  // Let LEDs start updating

  // Full viewport clip
  const vp = page.viewport()
  const clip = { x: 0, y: 0, width: vp.width, height: vp.height }
  const frames = await captureFrames(page, clip, 20, 120)

  // Stop
  const stop = await page.$('.btn-stop')
  if (stop) { await stop.click(); await sleep(300) }

  await encodeGif(frames, clip.width, clip.height, 120, 'gif-01-turbo-led.gif')
}

// ── GIF 02: Single-step debugging (registers light up) ───────────────────────
async function gif02_stepDebug(page) {
  console.log('  GIF 02 — Step debugging…')
  await loadExample(page, 'I/O', 'LED Count')
  await assemble(page)
  await setSpeed(page, 0)

  // Capture full width so editor + disasm + regs are all visible
  const vp = page.viewport()
  const clip = { x: 0, y: 0, width: vp.width, height: vp.height }

  const frames = []
  // Capture initial state
  frames.push(await page.screenshot({ clip }))
  await sleep(300)

  // Step 14 times, capturing after each
  for (let i = 0; i < 14; i++) {
    await page.click('.btn-step')
    await sleep(350)
    frames.push(await page.screenshot({ clip }))
  }

  await encodeGif(frames, clip.width, clip.height, 500, 'gif-02-step-debug.gif')
}

// ── GIF 03: Step Over ─────────────────────────────────────────────────────────
async function gif03_stepOver(page) {
  console.log('  GIF 03 — Step Over…')
  await loadExample(page, 'I/O', 'LED Count')
  await assemble(page)

  const vp = page.viewport()
  const clip = { x: 0, y: 0, width: vp.width, height: vp.height }

  const frames = []
  // Step a few times to get into the loop, then use step-over on CALL 5
  for (let i = 0; i < 4; i++) {
    await page.click('.btn-step')
    await sleep(300)
  }
  frames.push(await page.screenshot({ clip }))
  await sleep(200)

  // Now step-over several times (skips over CALL 5 as atomic step)
  for (let i = 0; i < 8; i++) {
    await page.click('.btn-step-over')
    await sleep(400)
    frames.push(await page.screenshot({ clip }))
  }

  await encodeGif(frames, clip.width, clip.height, 500, 'gif-03-step-over.gif')
}

// ── GIF 04: Breakpoint set and hit ───────────────────────────────────────────
async function gif04_breakpoint(page) {
  console.log('  GIF 04 — Breakpoint…')
  await loadExample(page, 'I/O', 'LED Count')
  await assemble(page)
  await sleep(300)

  const vp = page.viewport()
  const clip = { x: 0, y: 0, width: vp.width, height: vp.height }
  const frames = []

  // Capture initial assembled state
  frames.push(await page.screenshot({ clip }))
  await sleep(200)

  // Click a disasm row to set a breakpoint (row 6 = inside the loop)
  const rows = await page.$$('.disasm-row')
  const targetRow = rows[6] ?? rows[3]
  if (targetRow) {
    const bp = await targetRow.$('.disasm-bp')
    if (bp) await bp.click()
    else await targetRow.click()
    await sleep(300)
  }
  frames.push(await page.screenshot({ clip }))
  await sleep(200)

  // Run at fast speed — will stop at breakpoint
  await setSpeed(page, 3)
  await page.click('.btn-run')

  // Wait for it to stop (btn-run reappears when halted at breakpoint)
  try {
    await page.waitForSelector('.btn-run', { timeout: 5000 })
  } catch { /* already stopped */ }
  await sleep(400)
  frames.push(await page.screenshot({ clip }))

  // Step a couple more times from breakpoint
  for (let i = 0; i < 4; i++) {
    await page.click('.btn-step')
    await sleep(350)
    frames.push(await page.screenshot({ clip }))
  }

  await encodeGif(frames, clip.width, clip.height, 600, 'gif-04-breakpoint.gif')
}

// ── GIF 05: Step Back (time-travel debugging) ─────────────────────────────────
async function gif05_stepBack(page) {
  console.log('  GIF 05 — Step Back…')
  await loadExample(page, 'I/O', 'LED Count')
  await assemble(page)

  const vp = page.viewport()
  const clip = { x: 0, y: 0, width: vp.width, height: vp.height }
  const frames = []

  // Step forward 8 times
  for (let i = 0; i < 8; i++) {
    await page.click('.btn-step')
    await sleep(300)
  }
  frames.push(await page.screenshot({ clip }))
  await sleep(200)

  // Step back 5 times — show time-travel
  for (let i = 0; i < 5; i++) {
    await page.click('.btn-back')
    await sleep(400)
    frames.push(await page.screenshot({ clip }))
  }

  // Then step forward again
  for (let i = 0; i < 3; i++) {
    await page.click('.btn-step')
    await sleep(300)
    frames.push(await page.screenshot({ clip }))
  }

  await encodeGif(frames, clip.width, clip.height, 500, 'gif-05-step-back.gif')
}

// ── Main ──────────────────────────────────────────────────────────────────────
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
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    // 1x scale — keeps GIF dimensions and file size reasonable
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sim8085_welcomed', '1')
      localStorage.setItem('sim8085_theme', 'dark')
      localStorage.setItem('sim8085_panels', JSON.stringify({
        regs: true, pairs: true, flags: true, ints: true, io: true,
        memmap: false, ppi: false, pit: false, audio: true,
        stack: true, callstack: true, trace: true,
      }))
    })

    await page.goto(BASE, { waitUntil: 'networkidle0' })
    await sleep(800)
    console.log('App loaded. Generating GIFs…\n')

    await gif01_turboLed(page)
    await gif02_stepDebug(page)
    await gif03_stepOver(page)
    await gif04_breakpoint(page)
    await gif05_stepBack(page)

    await browser.close()
  } finally {
    server.kill()
  }

  console.log(`\nDone. GIFs written to: ${OUT}`)
}

main().catch(err => { console.error(err); process.exit(1) })
