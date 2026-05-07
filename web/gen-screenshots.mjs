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

async function run(page)  { await page.click('.btn-run') }
async function stop(page) {
  const btn = await page.$('.btn-stop')
  if (btn) { await btn.click(); await sleep(400) }
}

async function setTheme(page, theme) {
  await page.evaluate(t => {
    document.documentElement.setAttribute('data-theme', t)
    localStorage.setItem('sim8085_theme', t)
  }, theme)
  await sleep(300)
}

// ── Annotation system ─────────────────────────────────────────────────────────
// Labels float OUTSIDE panel content; dashed arrows point to the feature.

const LABEL_BG     = 'rgba(185, 168, 98, 0.94)'   // muted amber-gold
const LABEL_FG     = '#0e0e0e'
const ARROW_COLOR  = '#c4aa54'

async function injectAnnotations(page, anns) {
  // Step 1: inject label divs
  await page.evaluate((anns, bg, fg) => {
    for (const { text, x, y } of anns) {
      const el = document.createElement('div')
      el.className = '__sc_ann'
      el.dataset.annText = text
      Object.assign(el.style, {
        position: 'fixed', left: x + 'px', top: y + 'px',
        zIndex: '999999',
        font: '600 11px/1.45 ui-monospace, "Cascadia Code", monospace',
        color: fg, background: bg,
        border: '1px solid rgba(0,0,0,0.22)',
        borderRadius: '5px',
        padding: '5px 10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.45)',
        whiteSpace: 'pre', maxWidth: '260px',
        pointerEvents: 'none',
      })
      el.textContent = text
      document.body.appendChild(el)
    }
  }, anns, LABEL_BG, LABEL_FG)

  await sleep(120) // let layout settle so getBoundingClientRect is accurate

  // Step 2: measure label positions and draw SVG arrows
  await page.evaluate((anns, arrowCol) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.id = '__sc_ann_svg'
    Object.assign(svg.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: '999998',
      overflow: 'visible',
    })

    // Arrowhead marker
    const defs   = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
    marker.setAttribute('id', '__sc_arrow')
    marker.setAttribute('markerWidth', '7')
    marker.setAttribute('markerHeight', '5')
    marker.setAttribute('refX', '6')
    marker.setAttribute('refY', '2.5')
    marker.setAttribute('orient', 'auto')
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    poly.setAttribute('points', '0 0, 7 2.5, 0 5')
    poly.setAttribute('fill', arrowCol)
    marker.appendChild(poly)
    defs.appendChild(marker)
    svg.appendChild(defs)

    for (const { text, tx, ty } of anns) {
      if (tx == null || ty == null) continue
      const div = [...document.querySelectorAll('.__sc_ann')]
        .find(d => d.dataset.annText === text)
      if (!div) continue
      const r = div.getBoundingClientRect()

      // Pick nearest edge of label to target as line start
      const cx = r.left + r.width  / 2
      const cy = r.top  + r.height / 2
      // clamp start to label edge toward target
      const dx = tx - cx, dy = ty - cy
      const len = Math.sqrt(dx*dx + dy*dy)
      if (len < 1) continue
      const ux = dx / len, uy = dy / len
      const startX = Math.min(Math.max(cx + ux * r.width  / 2, r.left), r.right)
      const startY = Math.min(Math.max(cy + uy * r.height / 2, r.top ), r.bottom)

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', startX); line.setAttribute('y1', startY)
      line.setAttribute('x2', tx);     line.setAttribute('y2', ty)
      line.setAttribute('stroke', arrowCol)
      line.setAttribute('stroke-width', '1.5')
      line.setAttribute('stroke-dasharray', '5 3')
      line.setAttribute('marker-end', 'url(#__sc_arrow)')
      svg.appendChild(line)
    }
    document.body.appendChild(svg)
  }, anns, ARROW_COLOR)

  await sleep(80)
}

async function removeAnnotations(page) {
  await page.evaluate(() =>
    document.querySelectorAll('.__sc_ann, #__sc_ann_svg').forEach(el => el.remove())
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

// ── Shot 01: Full app — LED counter running ───────────────────────────────────
async function shot01_ledCount(page) {
  console.log('  Shot 01 — LED Count (full view)…')
  await loadExample(page, 'I/O', 'LED Count')
  await build(page)
  await setSpeed(page, 4)
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
  const editor  = await getRect(page, '.cm-editor')

  const ty = toolbar?.y ?? 0
  const th = toolbar?.h ?? 44

  // Labels sit ABOVE the content they describe (in the toolbar strip or just above panel)
  const anns = [
    {
      text: '✏️  Write 8085 assembly\nSyntax highlighting · auto-indent',
      x: col.x + 8, y: ty + 6,
      tx: editor ? editor.x + editor.w * 0.5 : col.x + col.w * 0.5,
      ty: editor ? editor.y + 80 : col.y + th + 80,
    },
    {
      text: '📂  20+ built-in examples\nArithmetic · Strings · I/O · Interrupts',
      x: col.x + 8, y: ty + 56,
      tx: col.x + col.w * 0.85,
      ty: ty + 22,
    },
    {
      text: '💡  7-segment LED display\nDriven by Intel SDK CALL 5',
      x: col.x + 8,
      y: led ? led.y - 58 : col.y + col.h - 160,
      tx: led ? led.x + led.w * 0.5 : col.x + col.w * 0.5,
      ty: led ? led.y + led.h * 0.4 : col.y + col.h - 80,
    },
  ]

  await injectAnnotations(page, anns)
  await page.screenshot({
    path: path.join(OUT, '02-editor-panel.png'),
    clip: { x: Math.round(col.x), y: Math.round(ty), width: Math.round(col.w), height: Math.round(th + col.h) },
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

  const ty = toolbar?.y ?? 0
  const th = toolbar?.h ?? 44

  const disY = disasm?.y ?? col.y + th
  const memY = mem?.y    ?? col.y + th + col.h * 0.5

  const anns = [
    {
      text: '📋  Live disassembly\nPC highlighted · click row to set breakpoint',
      x: col.x + 8, y: ty + 6,
      tx: col.x + col.w * 0.5,
      ty: disY + 60,
    },
    {
      text: '💾  Hex memory editor\nDouble-click any cell to edit\nPC and SP highlighted in colour',
      x: col.x + 8, y: memY - 70,
      tx: col.x + col.w * 0.5,
      ty: memY + 80,
    },
  ]

  await injectAnnotations(page, anns)
  await page.screenshot({
    path: path.join(OUT, '03-center-panel.png'),
    clip: { x: Math.round(col.x), y: Math.round(ty), width: Math.round(col.w), height: Math.round(th + col.h) },
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

  const ty = toolbar?.y ?? 0
  const th = toolbar?.h ?? 44

  const regsY = regs?.y ?? col.y + th
  const intY  = intp?.y ?? col.y + th + 300
  const ioY   = iop?.y  ?? col.y + th + 500

  const anns = [
    {
      text: '🧠  Registers & flags\nHighlighted green on each step',
      x: col.x + 6, y: ty + 6,
      tx: col.x + col.w * 0.5,
      ty: regsY + 60,
    },
    {
      text: '🔔  TRAP · RST 7.5 / 6.5 / 5.5\nFire interrupts mid-program',
      x: col.x + 6, y: intY - 62,
      tx: col.x + col.w * 0.5,
      ty: intY + 40,
    },
    {
      text: '🔌  I/O ports · keyboard queue\nRead port values · queue keystrokes',
      x: col.x + 6, y: ioY - 62,
      tx: col.x + col.w * 0.5,
      ty: ioY + 40,
    },
  ]

  await injectAnnotations(page, anns)
  await page.screenshot({
    path: path.join(OUT, '04-right-panel.png'),
    clip: { x: Math.round(col.x), y: Math.round(ty), width: Math.round(col.w), height: Math.round(th + col.h) },
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

  const rows = await page.$$('.disasm-row')
  const target = rows[5] ?? rows[Math.floor(rows.length / 2)]
  if (target) {
    const bp = await target.$('.disasm-bp')
    if (bp) await bp.click()
    else    await target.click()
    await sleep(200)
  }

  await setSpeed(page, 3)
  await run(page)
  try {
    await page.waitForFunction(() => !!document.querySelector('.btn-run'), { timeout: 5000 })
  } catch { await stop(page) }
  await sleep(400)

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-center')
  const disasm  = await getRect(page, '.disasm-panel')
  const ty = toolbar?.y ?? 0
  const th = toolbar?.h ?? 44

  const anns = [
    {
      text: '🔴  Paused at breakpoint\nClick any disasm row to toggle one\nResume with Run or continue stepping',
      x: col.x + 8, y: ty + 6,
      tx: col.x + col.w * 0.5,
      ty: (disasm?.y ?? col.y + th) + 80,
    },
  ]
  await injectAnnotations(page, anns)
  await page.screenshot({
    path: path.join(OUT, '05-breakpoint.png'),
    clip: { x: Math.round(col.x), y: Math.round(ty), width: Math.round(col.w), height: Math.round(th + col.h) },
  })
  await removeAnnotations(page)
  console.log('  Saved: 05-breakpoint.png')
}

// ── Shot 06: TRAP interrupt fired ─────────────────────────────────────────────
async function shot06_interrupt(page) {
  console.log('  Shot 06 — TRAP interrupt…')
  await loadExample(page, 'Interrupts', 'TRAP (NMI)')
  await build(page)
  await setSpeed(page, 0)
  await run(page)
  await sleep(600)

  const fireBtns = await page.$$('.int-btn')
  if (fireBtns[0]) { await fireBtns[0].click(); await sleep(300) }
  await stop(page)

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-right')
  const intp    = await getRect(page, '.int-panel')
  const iop     = await getRect(page, '.ioport-panel')
  const ty = toolbar?.y ?? 0
  const th = toolbar?.h ?? 44

  const anns = [
    {
      text: '🔔  TRAP fired mid-program\nNon-maskable · ignores IFF and masks',
      x: col.x + 6, y: ty + 6,
      tx: col.x + col.w * 0.5,
      ty: (intp?.y ?? col.y + th + 280) + 60,
    },
    {
      text: '📊  ISR wrote to output port 02H\nI/O port values live in this panel',
      x: col.x + 6, y: (iop?.y ?? col.y + th + 480) - 62,
      tx: col.x + col.w * 0.5,
      ty: (iop?.y ?? col.y + th + 480) + 40,
    },
  ]
  await injectAnnotations(page, anns)
  await page.screenshot({
    path: path.join(OUT, '06-interrupt.png'),
    clip: { x: Math.round(col.x), y: Math.round(ty), width: Math.round(col.w), height: Math.round(th + col.h) },
  })
  await removeAnnotations(page)
  console.log('  Saved: 06-interrupt.png')
}

// ── Shot 07: Keyboard queue ───────────────────────────────────────────────────
async function shot07_keyboard(page) {
  console.log('  Shot 07 — Keyboard queue…')
  await loadExample(page, 'I/O', 'Keyboard Read')
  await build(page)

  await page.evaluate(() => {
    const inp = document.querySelector('.ioport-kbd-input')
    if (!inp) return
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    nativeSetter.call(inp, 'Hello 8085')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(150)
  await page.evaluate(() => {
    const btn = document.querySelector('.ioport-kbd-input + button')
    if (btn) btn.click()
  })
  await sleep(400)

  await page.evaluate(() => {
    const col = document.querySelector('.col-right')
    if (col) { col.style.overflow = 'auto'; col.scrollTop = col.scrollHeight }
  })
  await sleep(200)

  const toolbar = await getRect(page, '.toolbar')
  const col     = await getRect(page, '.col-right')
  const ty = toolbar?.y ?? 0
  const th = toolbar?.h ?? 44

  const kbdY = await page.evaluate(() => {
    const chips = document.querySelector('.ioport-kbd-chips')
    return chips ? chips.getBoundingClientRect().y : null
  })

  const anns = [
    {
      text: '⌨️  Keyboard queue\nChars dequeued via CALL 5 / C=01H',
      x: col.x + 6, y: ty + 6,
      tx: col.x + col.w * 0.5,
      ty: kbdY != null ? kbdY + 40 : col.y + th + 200,
    },
  ]
  await injectAnnotations(page, anns)
  await page.screenshot({
    path: path.join(OUT, '07-keyboard.png'),
    clip: { x: Math.round(col.x), y: Math.round(ty), width: Math.round(col.w), height: Math.round(th + col.h) },
  })
  await removeAnnotations(page)

  await page.evaluate(() => {
    const col = document.querySelector('.col-right')
    if (col) { col.style.overflow = 'hidden'; col.scrollTop = 0 }
  })
  console.log('  Saved: 07-keyboard.png')
}

// ── Theme showcase shots (one full-viewport per theme) ───────────────────────

async function shotTheme(page, theme, filename) {
  console.log(`  Theme shot — ${theme}…`)
  await loadExample(page, 'I/O', 'LED Count')
  await build(page)
  await setSpeed(page, 4)
  await run(page)
  await sleep(2000)
  await stop(page)
  await setTheme(page, theme)
  await page.screenshot({ path: path.join(OUT, filename) })
  console.log(`  Saved: ${filename}`)
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
      localStorage.setItem('sim8085_theme', 'dark')
      // Hide 8255 PPI floating panel (and 8253 PIT)
      localStorage.setItem('sim8085_panels', JSON.stringify({
        regs: true, pairs: true, flags: true, ints: true, io: true,
        memmap: false, ppi: false, pit: false, audio: true,
        stack: true, callstack: true, trace: true,
      }))
    })

    await page.goto(BASE, { waitUntil: 'networkidle0' })
    await sleep(600)
    console.log('App loaded (dark theme, PPI/PIT hidden).')

    // Dark theme shots
    await shot01_ledCount(page)
    await shot02_editor(page)
    await shot03_center(page)
    await shot04_right(page)
    await shot05_breakpoint(page)
    await shot06_interrupt(page)
    await shot07_keyboard(page)

    // Theme showcase shots
    await shotTheme(page, 'green',      'theme-green.png')
    await shotTheme(page, 'dim',        'theme-dim.png')
    await shotTheme(page, 'light',      'theme-light.png')
    await shotTheme(page, 'amber-mono', 'theme-amber-mono.png')
    await shotTheme(page, 'gray-crt',   'theme-gray-crt.png')
    await shotTheme(page, 'turbo-c',    'theme-turbo-c.png')
    await shotTheme(page, 'cp437',      'theme-cp437.png')

    await browser.close()
  } finally {
    server.kill()
  }

  console.log(`\nDone. Screenshots written to: ${OUT}`)
}

main().catch(err => { console.error(err); process.exit(1) })
