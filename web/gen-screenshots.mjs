/**
 * gen-screenshots.mjs
 * Captures annotated screenshots of the simulator using Puppeteer.
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

// ── Annotation helpers ────────────────────────────────────────────────────────

const ANN_STYLE = `
  position: fixed;
  z-index: 999999;
  font: 600 13px/1.45 ui-monospace, 'Cascadia Code', monospace;
  color: #0d0d0d;
  background: rgba(255, 210, 60, 0.97);
  border: 1.5px solid rgba(0,0,0,0.3);
  border-radius: 5px;
  padding: 7px 12px;
  box-shadow: 0 3px 14px rgba(0,0,0,0.55);
  white-space: pre;
  max-width: 360px;
  pointer-events: none;
`

async function injectAnnotations(page, labels) {
  await page.evaluate((labels, style) => {
    labels.forEach(({ text, x, y }) => {
      const el = document.createElement('div')
      el.className = '__sc_ann'
      el.style.cssText = style + `left:${x}px; top:${y}px;`
      el.textContent = text
      document.body.appendChild(el)
    })
  }, labels, ANN_STYLE)
  await sleep(120)
}

async function removeAnnotations(page) {
  await page.evaluate(() =>
    document.querySelectorAll('.__sc_ann').forEach(el => el.remove())
  )
}

async function getRect(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, selector)
}

async function shotClip(page, filename, selector, labels, extraTop = 0) {
  const r = await getRect(page, selector)
  if (!r) throw new Error(`Selector not found: ${selector}`)
  await injectAnnotations(page, labels)
  const clip = {
    x: r.x,
    y: Math.max(0, r.y - extraTop),
    width: r.w,
    height: r.h + extraTop,
  }
  await page.screenshot({ path: path.join(OUT, filename), clip })
  await removeAnnotations(page)
  console.log(`  Saved: ${filename}`)
}

// ── Shot 01: Full app — LED counter running ───────────────────────────────────
async function shot01_ledCount(page) {
  console.log('  Shot 01 — LED Count (full view)…')
  await loadExample(page, 'I/O', 'LED Count')
  await build(page)
  await setSpeed(page, 4)   // Turbo
  await run(page)
  await sleep(3000)
  await stop(page)
  await page.screenshot({ path: path.join(OUT, '01-led-count.png') })
  console.log('  Saved: 01-led-count.png')
}

// ── Shot 02: Left panel — Editor ──────────────────────────────────────────────
async function shot02_editor(page) {
  console.log('  Shot 02 — Editor panel…')

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-editor')
  const led     = await getRect(page, '.led-panel')

  const ty = toolbar ? toolbar.y : 0
  const th = toolbar ? toolbar.h : 40

  const labels = [
    {
      text: '✏️  Write 8085 assembly\nSyntax highlighting · auto-indent',
      x: col.x + 12,
      y: col.y + 52,
    },
    {
      text: '📂  20+ built-in examples\nArithmetic · Strings · I/O\nInterrupts · Algorithms',
      x: col.x + 12,
      y: col.y + 220,
    },
    {
      text: '💡  7-segment LED display\nDriven by Intel SDK CALL 5',
      x: col.x + 12,
      y: (led ? led.y : col.y + col.h - 130) + 8,
    },
  ]

  await injectAnnotations(page, labels)
  await page.screenshot({
    path: path.join(OUT, '02-editor-panel.png'),
    clip: { x: col.x, y: ty, width: col.w, height: th + col.h },
  })
  await removeAnnotations(page)
  console.log('  Saved: 02-editor-panel.png')
}

// ── Shot 03: Center panel — Disassembly + Memory ──────────────────────────────
async function shot03_center(page) {
  console.log('  Shot 03 — Center panel…')

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-center')
  const disasm  = await getRect(page, '.disasm-panel')
  const mem     = await getRect(page, '.mem-panel')

  const ty = toolbar ? toolbar.y : 0
  const th = toolbar ? toolbar.h : 40

  const labels = [
    {
      text: '📋  Live disassembly\nClick any row to set a breakpoint',
      x: col.x + 12,
      y: (disasm ? disasm.y : col.y) + 44,
    },
    {
      text: '💾  Hex memory editor\nDouble-click any cell to edit\nPC and SP highlighted',
      x: col.x + 12,
      y: (mem ? mem.y : col.y + col.h / 2) + 44,
    },
  ]

  await injectAnnotations(page, labels)
  await page.screenshot({
    path: path.join(OUT, '03-center-panel.png'),
    clip: { x: col.x, y: ty, width: col.w, height: th + col.h },
  })
  await removeAnnotations(page)
  console.log('  Saved: 03-center-panel.png')
}

// ── Shot 04: Right panel — Registers + Interrupts + I/O ──────────────────────
async function shot04_right(page) {
  console.log('  Shot 04 — Right panel…')

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-right')
  const regs    = await getRect(page, '.reg-panel')
  const intp    = await getRect(page, '.int-panel')
  const iop     = await getRect(page, '.ioport-panel')

  const ty = toolbar ? toolbar.y : 0
  const th = toolbar ? toolbar.h : 40

  const labels = [
    {
      text: '🧠  Registers & flags\nHighlighted green on each step',
      x: col.x + 8,
      y: (regs ? regs.y : col.y) + 44,
    },
    {
      text: '🔔  TRAP · RST 7.5/6.5/5.5\nFire interrupts mid-program',
      x: col.x + 8,
      y: (intp ? intp.y : col.y + 400) + 10,
    },
    {
      text: '🔌  I/O ports · keyboard queue\nRead ports · queue keystrokes',
      x: col.x + 8,
      y: (iop ? iop.y : col.y + 540) + 10,
    },
  ]

  await injectAnnotations(page, labels)
  await page.screenshot({
    path: path.join(OUT, '04-right-panel.png'),
    clip: { x: col.x, y: ty, width: col.w, height: th + col.h },
  })
  await removeAnnotations(page)
  console.log('  Saved: 04-right-panel.png')
}

// ── Shot 05: Breakpoint hit ───────────────────────────────────────────────────
async function shot05_breakpoint(page) {
  console.log('  Shot 05 — Breakpoint hit…')
  await loadExample(page, 'I/O', 'LED Count')
  await build(page)
  await sleep(300)

  // Set a breakpoint on the 5th disasm row (should land in the loop body)
  const rows = await page.$$('.disasm-row')
  const target = rows[5] ?? rows[Math.floor(rows.length / 2)]
  if (target) {
    const bp = await target.$('.disasm-bp')
    if (bp) await bp.click()
    else await target.click()
    await sleep(200)
  }

  await setSpeed(page, 3)  // Fast — hit breakpoint quickly
  await run(page)
  try {
    await page.waitForFunction(
      () => !!document.querySelector('.btn-run'),
      { timeout: 5000 }
    )
  } catch { await stop(page) }
  await sleep(400)

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-center')
  const disasm  = await getRect(page, '.disasm-panel')
  const ty = toolbar ? toolbar.y : 0
  const th = toolbar ? toolbar.h : 40

  const labels = [
    {
      text: '🔴  Paused at breakpoint\nClick any disasm row to toggle one',
      x: col.x + 12,
      y: (disasm ? disasm.y : col.y) + 46,
    },
  ]
  await injectAnnotations(page, labels)
  await page.screenshot({
    path: path.join(OUT, '05-breakpoint.png'),
    clip: { x: col.x, y: ty, width: col.w, height: th + col.h },
  })
  await removeAnnotations(page)
  console.log('  Saved: 05-breakpoint.png')
}

// ── Shot 06: TRAP interrupt fired ─────────────────────────────────────────────
async function shot06_interrupt(page) {
  console.log('  Shot 06 — TRAP interrupt…')
  await loadExample(page, 'Interrupts', 'TRAP (NMI)')
  await build(page)
  await setSpeed(page, 0)  // Crawl — gives time to screenshot PEND state
  await run(page)
  await sleep(600)

  // Fire TRAP — first int-btn is TRAP
  const fireBtns = await page.$$('.int-btn')
  if (fireBtns[0]) { await fireBtns[0].click(); await sleep(300) }
  await stop(page)

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-right')
  const intp    = await getRect(page, '.int-panel')
  const iop     = await getRect(page, '.ioport-panel')
  const ty = toolbar ? toolbar.y : 0
  const th = toolbar ? toolbar.h : 40

  const labels = [
    {
      text: '🔔  TRAP fired mid-program\nNon-maskable · ignores IFF and masks',
      x: col.x + 8,
      y: (intp ? intp.y : col.y + 380) - 52,
    },
    {
      text: '📊  ISR updated output port 02H\nPort values visible in I/O panel',
      x: col.x + 8,
      y: (iop ? iop.y : col.y + 560) + 10,
    },
  ]
  await injectAnnotations(page, labels)
  await page.screenshot({
    path: path.join(OUT, '06-interrupt.png'),
    clip: { x: col.x, y: ty, width: col.w, height: th + col.h },
  })
  await removeAnnotations(page)
  console.log('  Saved: 06-interrupt.png')
}

// ── Shot 07: Keyboard queue ───────────────────────────────────────────────────
async function shot07_keyboard(page) {
  console.log('  Shot 07 — Keyboard queue…')
  await loadExample(page, 'I/O', 'Keyboard Read')
  await build(page)

  // Type into the keyboard input and submit via JS (more reliable than ElementHandle click)
  await page.evaluate(() => {
    const inp = document.querySelector('.ioport-kbd-input')
    if (!inp) return
    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set
    nativeInputSetter.call(inp, 'Hello 8085')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(150)
  await page.evaluate(() => {
    const btn = document.querySelector('.ioport-kbd-input + button')
    if (btn) btn.click()
  })
  await sleep(400)

  // Scroll col-right to bottom so the keyboard chips are visible
  await page.evaluate(() => {
    const col = document.querySelector('.col-right')
    if (col) { col.style.overflow = 'auto'; col.scrollTop = col.scrollHeight }
  })
  await sleep(200)

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-right')
  const ty = toolbar ? toolbar.y : 0
  const th = toolbar ? toolbar.h : 40

  // Measure keyboard section position now that column is scrolled
  const kbdY = await page.evaluate(() => {
    const chips = document.querySelector('.ioport-kbd-chips')
    if (!chips) return null
    return chips.getBoundingClientRect().y
  })

  const labelY = kbdY != null ? kbdY - 52 : col.y + 200
  const labels = [
    {
      text: '⌨️  Keyboard queue\nDequeued one-by-one via CALL 5 C=01H',
      x: col.x + 8,
      y: labelY,
    },
  ]
  await injectAnnotations(page, labels)
  await page.screenshot({
    path: path.join(OUT, '07-keyboard.png'),
    clip: { x: col.x, y: ty, width: col.w, height: th + col.h },
  })
  await removeAnnotations(page)

  // Restore col-right overflow
  await page.evaluate(() => {
    const col = document.querySelector('.col-right')
    if (col) { col.style.overflow = 'hidden'; col.scrollTop = 0 }
  })
  console.log('  Saved: 07-keyboard.png')
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
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })

    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sim8085_welcomed', '1')
    })

    await page.goto(BASE, { waitUntil: 'networkidle0' })
    await sleep(600)
    console.log('App loaded.')

    await shot01_ledCount(page)
    await shot02_editor(page)
    await shot03_center(page)
    await shot04_right(page)
    await shot05_breakpoint(page)
    await shot06_interrupt(page)
    await shot07_keyboard(page)

    await browser.close()
  } finally {
    server.kill()
  }

  console.log(`\nDone. Screenshots written to: ${OUT}`)
}

main().catch(err => { console.error(err); process.exit(1) })
