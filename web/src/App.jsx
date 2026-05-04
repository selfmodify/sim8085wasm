import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration, GutterMarker, gutter } from '@codemirror/view'
import { EditorState, StateEffect, StateField, RangeSetBuilder, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import * as sim from './simProxy.js'
import { getEngineMode, switchEngine } from './simProxy.js'
import { EXAMPLES } from './examples.js'
import { INST_HELP } from './instHelp.js'
import { hex2, hex4, b64encode, b64decode, BASE_CYCLE, SPEEDS, fmtByte, fmtWord, TRACE_REG16, fmtTraceVal, evalCondition, fmtCount } from './utils.js'
import { asm8085Lang, asm8085Highlighting } from './lang.js'
import './App.css'

// ── CM6 error-line decoration + gutter marker ─────────────────────────────
const setErrorLineEff = StateEffect.define()

class ErrorGutterMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span')
    el.textContent = '✕'
    el.className = 'cm-error-gutter-marker'
    return el
  }
}
const errorGutterMarker = new ErrorGutterMarker()

const errorGutterState = StateField.define({
  create: () => new RangeSetBuilder().finish(),
  update(markers, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLineEff)) {
        if (!e.value) return new RangeSetBuilder().finish()
        try {
          const line = tr.newDoc.line(e.value)
          const b = new RangeSetBuilder()
          b.add(line.from, line.from, errorGutterMarker)
          return b.finish()
        } catch { return new RangeSetBuilder().finish() }
      }
    }
    return markers
  },
})
const errorGutterExt = gutter({
  class: 'cm-error-gutter',
  markers: view => view.state.field(errorGutterState),
  initialSpacer: () => errorGutterMarker,
})
const errorLineField  = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLineEff)) {
        if (e.value == null) return Decoration.none
        try {
          const line = tr.state.doc.line(e.value)
          return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)])
        } catch { return Decoration.none }
      }
    }
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

function buildAddrLineMap(code) {
  const map = new Map()
  let pc = 0
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i].replace(/;.*$/, '').trim().toLowerCase()
    if (!text) continue
    if (text.startsWith('org ')) { pc = parseInt(text.slice(4).replace(/h$/,''), 16) || pc; continue }
    if (text.startsWith('kickoff ') || text.startsWith('setbyte ') || text.startsWith('setword ')) continue
    text = text.replace(/^[a-z_]\w*:\s*/, '')
    if (!text) continue
    map.set(pc, i + 1)
    const d = sim.simDisassemble(pc)
    pc += Math.max(1, d.len)
  }
  return map
}

// ── Panel help descriptions ──────────────────────────────────────────────
const PANEL_HELP_TEXT = {
  'EDITOR': `• Write 8085 assembly — one instruction per line
• ORG <addr>  sets the load address
• KICKOFF <addr>  sets the entry point (where execution starts)
• Ctrl+click any mnemonic → full instruction docs
• Ctrl+F → find / replace bar
• Right-click an assembled line → run execution up to that line
• Directives: EQU, DB, DW, DS (highlighted purple)
• Pseudo-ops: KICKOFF, SETBYTE, SETWORD, ASSERT (highlighted red)`,

  'INSTRUCTION HELP': `• Shows docs for the instruction under your cursor
• Updates live as you type or move the cursor
• Displays: flags affected, byte size, T-state count, example
• Ctrl+click a mnemonic in the editor to pin its details`,

  'LED DISPLAY': `• Simulates the Intel SDK-85 7-segment LED display
• Drive it with CALL 5 system calls:
  · C=02H  write digit  (B=field, HL→data byte)
  · C=09H  scroll left, insert D as new right digit
  · C=0BH  scroll left with delay
  · C=03H  blank all fields
• Load the "LED Scroll" example to see it in action`,

  'DISASSEMBLY': `• Live disassembly of RAM starting from any address
• Type a hex address in the header + Enter to jump there
• PC↓ button  locks view to follow the program counter
• PC·  button  unlocks for free scrolling
• Each row shows the T-state cycle count on the right
• Click · in the gutter to set a breakpoint (●)
• Right-click a breakpoint to add a condition expression
• Breakpoint list below: jump to or remove any breakpoint
• Click a disasm row to jump the editor to that source line`,

  'AI ASSISTANT': `• Ask questions about your 8085 code
• Current register state + source are sent automatically
• Requires your own Anthropic API key
• Key is stored in this browser only — never sent elsewhere
• Click ⚙ to enter or change your API key`,

  'MEMORY': `• Hex dump of the full configured RAM
• Green cell = program counter (PC)
• Amber cell = stack pointer (SP)
• Blue cells = assembled program region
• Double-click a cell to edit its value
• Arrow keys + PgUp/PgDn to navigate
• Mouse wheel scrolls the view
• Drag the top handle to resize the panel

🔍 Search (hex byte):
• Enter a hex byte and press Search
• Matching cells highlight amber
• ◀ ▶ step through all hits

⊞ Fill range:
• Enter start address, end address, fill value
• Cells in range preview highlighted before filling
• Press Fill range to write the byte across the range

⬇ Export range:
• Download any selected memory range to a raw .bin file`,

  'MEMORY MAP': `• Visual representation of the 64KB address space
• Code (Blue): Assembled instructions
• Data (Green): Values injected via SETBYTE/SETWORD/DB/DW
• Stack (Amber): Region from SP to FFFFH
• Click any region to see its exact address bounds
• Bright green line indicates current Program Counter (PC)`,

  'REGISTERS': `• Live 8085 register values (A, B, C, D, E, H, L, PC, SP)
• Click any value to edit it inline
• Right-click a value to copy it to the clipboard
• HEX / DEC / BIN toggle cycles the display format
• Green highlight = register changed since last step
• Bit toggles below A let you flip individual bits`,

  'REGISTER PAIRS': `• BC, DE, HL shown as combined 16-bit pointers
• ADDR column: the 16-bit address held by the pair
• CONTENT column: the byte in RAM at that address
• Click ADDR to jump the memory view there
• Click CONTENT to edit the byte at that address
• Right-click either cell to copy its value
• HEX / DEC / BIN toggle applies to both columns`,

  'FLAGS': `• Five 8085 status flags, updated after each instruction:
  · S   Sign flag — set if result is negative
  · Z   Zero flag — set if result is zero
  · AC  Auxiliary Carry — carry from bit 3 to 4 (BCD)
  · P   Parity — set if result has even number of 1-bits
  · CY  Carry — set if arithmetic produced a carry/borrow`,

  'STACK': `• Shows memory at and above SP as a 16-bit value stack
• Top entry (current SP) is highlighted green
• PUSH rp: SP − 2, stores high byte then low byte
• POP rp:  loads low byte then high byte, SP + 2
• Stack grows downward — set SP before using PUSH`,

  'TRACE': `• Last 50 instructions executed, newest at bottom
• Each row: address · disassembled text · changed registers
• Changed register values are highlighted green
• Cleared on every Build
• Step through code to populate the trace`,

  'WATCH': `• Monitor any register or memory location in real time
• Type a register name: A, B, BC, HL, SP, PC …
• Type a hex address: 0200H, 1000H …
• Press Enter or + to add it to the list
• Values update automatically after every step
• Click × on any row to remove it`,

  'CALCULATOR': `• Converts 16-bit values across four bases simultaneously
• BIN / OCT / DEC / HEX — type in any field
• All other fields update instantly
• Handy for working out immediate operands or addresses`,

  'I/O PORTS': `• OUTPUT section: ports written by OUT instructions
  · Values appear here after each OUT port, A
  · Cleared on every Build
• INPUT section: preset values for IN to read
  · Type a port number + value, press Enter
  · Presets survive a Build
  · Used by IN port, A when the program reads that port
• KEYBOARD section: character queue for syscall C=01H
  · Type text and press Enter (or +) to enqueue characters
  · Each CALL 5 with C=01H dequeues the next char (returns 00H when empty)
  · ✕ clears the entire queue`,

  'CONSOLE': `• Treats bytes written by OUT to the configured port as ASCII text
• Default port is 01H — change it in the header field
• Printable characters (20H–7EH) are appended as-is
• 0AH (\\n) starts a new line; 0DH (\\r) is ignored; 08H (BS) deletes the last char
• ✕ button clears the display — also cleared on every Build
• Example: OUT 01H with A=48H prints 'H'`,

  'SYMBOLS': `• All labels defined in your source code
• Populated after a successful Build
• Shows label name and resolved hex address
• Click any row to jump the memory view to that address`,

  'INTERRUPTS': `• Controls the 8085 interrupt lines in real time
• IFF — Interrupt Flip-Flop: set by EI, cleared by DI or when an interrupt is taken
• TRAP — non-maskable, fires once per click regardless of IFF or mask
• RST 7.5 — edge-triggered latch: FIRE sets the latch; it clears when serviced or via SIM b4=1
• RST 6.5 / RST 5.5 — level-triggered: ON holds the line high until you click OFF
• INTR — level-triggered; select which RST n vector (0–7) appears on the data bus
• Mask badges appear when the program has masked a line via SIM
• Write ISRs at the vector addresses (e.g. ORG 003CH for RST 7.5) and end them with EI + RET`,

  '8255 PPI': `• Programmable Peripheral Interface (Ports 00H–03H)
• Control Word (03H) configures ports A, B, and C as Input or Output
• Mode 0 is supported (basic I/O)
• Output ports display the bits sent via OUT
• Input ports provide clickable bits to toggle state for IN`,

  '8253 PIT': `• Programmable Interval Timer (Ports 10H–13H)
• Control Word (13H) selects counter and mode
• Counters 0, 1, and 2 are mapped to 10H, 11H, and 12H
• Currently serves as a visual decoder for the control word and counter values`,

  'AUDIO OUTPUT': `• Web Audio API synthesizer mapped to PORT 40H
• OUT 40H with a value > 0 generates a square wave tone
• OUT 40H with 0 mutes the audio
• Must click the ON button first to enable audio output
• Use Fast speed (not Warp) for best playback timing`,
}

function PanelHelp({ panel, wide }) {
  const [popupPos, setPopupPos] = useState(null)  // null = hidden, {top,bottom,left} = visible
  const wrapRef = useRef(null)
  const text = PANEL_HELP_TEXT[panel]
  const show = popupPos !== null

  useEffect(() => {
    if (!show) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setPopupPos(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [show])
  useEffect(() => {
    if (!show) return
    const h = e => { if (e.key === 'Escape') setPopupPos(null) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [show])

  if (!text) return null

  const toggle = () => {
    if (show) { setPopupPos(null); return }
    if (!wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const popupW = wide ? 420 : 300
    const left = Math.max(8, Math.min(rect.right - popupW, window.innerWidth - popupW - 8))
    const spaceBelow = window.innerHeight - rect.bottom
    if (spaceBelow < 280) {
      setPopupPos({ bottom: window.innerHeight - rect.top + 5, top: 'auto', left })
    } else {
      setPopupPos({ top: rect.bottom + 5, bottom: 'auto', left })
    }
  }

  return (
    <div className="panel-help-wrap" ref={wrapRef}>
      <button className="panel-help-btn" onClick={toggle} title="Panel help">?</button>
      {show && (
        <div className={`panel-help-popup${wide ? ' panel-help-popup-wide' : ''}`}
          style={{ top: popupPos.top, bottom: popupPos.bottom, left: popupPos.left }}>
          {text}
        </div>
      )}
    </div>
  )
}

function getInstWord(state, pos) {
  const line = state.doc.lineAt(pos)
  const text = line.text
  const lp = pos - line.from
  let s = lp, e = lp
  while (s > 0 && /[A-Za-z]/.test(text[s - 1])) s--
  while (e < text.length && /[A-Za-z]/.test(text[e])) e++
  return s < e ? text.slice(s, e).toUpperCase() : null
}


// ── 7-segment LED digit ──────────────────────────────────────────────────
function SevenSeg({ value }) {
  const ON = 'var(--led-on, #FF2200)', OFF = 'var(--led-off, rgba(255, 34, 0, 0.15))'
  const segs = [
    { id:'a', d:'M3 1 L11 1 L10 3 L4 3 Z', bit:1 },
    { id:'b', d:'M11 2 L13 4 L12 10 L10 8 L10 3 Z', bit:2 },
    { id:'c', d:'M12 10 L13 18 L11 20 L9 18 L10 12 Z', bit:4 },
    { id:'d', d:'M3 19 L11 19 L10 21 L4 21 Z', bit:8 },
    { id:'e', d:'M1 10 L3 8 L4 12 L3 18 L1 18 Z', bit:16 },
    { id:'f', d:'M1 2 L4 2 L4 8 L2 10 L1 8 Z', bit:32 },
    { id:'g', d:'M3 9 L5 8 L9 8 L11 9 L9 10 L5 10 Z', bit:64 },
    { id:'dot', d:'M14 19 L16 19 L16 21 L14 21 Z', bit:128 },
  ]
  return (
    <svg width="33" height="48" viewBox="0 0 17 23">
      {segs.map(s => <path key={s.id} d={s.d} fill={value & s.bit ? ON : OFF} />)}
    </svg>
  )
}

// ── CodeMirror editor ────────────────────────────────────────────────────
function AsmEditor({ value, onChange, onCursorInstruction, onInstructionDetail, errorLine, gotoRef, onRunTo, lineAddrRef, theme }) {
  const elRef      = useRef(null)
  const viewRef    = useRef(null)
  const syncing    = useRef(false)
  const cursorCb   = useRef(onCursorInstruction)
  const detailCb   = useRef(onInstructionDetail)
  const onRunToRef = useRef(onRunTo)
  const themeConf  = useRef(new Compartment())
  const [editorCtx, setEditorCtx] = useState(null)  // {addr, x, y}
  useEffect(() => { cursorCb.current   = onCursorInstruction }, [onCursorInstruction])
  useEffect(() => { detailCb.current   = onInstructionDetail }, [onInstructionDetail])
  useEffect(() => { onRunToRef.current = onRunTo },             [onRunTo])

  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({ effects: setErrorLineEff.of(errorLine ?? null) })
  }, [errorLine])

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          lineNumbers(),
          highlightActiveLine(),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          themeConf.current.of(EditorView.theme({}, { dark: theme !== 'light' })),
          asm8085Lang.extension,
          asm8085Highlighting,
          errorLineField,
          errorGutterState,
          errorGutterExt,
          EditorView.theme({
            '&': { height:'100%', fontFamily:'"JetBrains Mono","Fira Code",monospace', fontSize:'15px', color:'var(--text)', backgroundColor:'transparent' },
            '.cm-scroller': { overflow:'auto' },
            '.cm-content': { padding:'8px 0', minHeight:'100%', caretColor:'var(--accent)' },
            '&.cm-focused .cm-cursor': { borderLeftColor:'var(--accent)' },
            '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor:'var(--bg3)' },
            '.cm-activeLine, .cm-activeLineGutter': { backgroundColor:'var(--bg2)' },
            '.cm-gutters': { backgroundColor:'transparent', color:'var(--text3)', borderRight:'1px solid var(--border)' },
            '.cm-error-line': { background: 'rgba(255,60,60,0.18)' },
            '.cm-error-gutter': { width: '14px' },
            '.cm-error-gutter-marker': { color: 'var(--red)', fontSize: '10px', lineHeight: '1.6', cursor: 'default' },
            '.cm-search': { background:'var(--bg2)', borderTop:'1px solid var(--border)', padding:'4px 8px', gap:'6px' },
            '.cm-search input': { background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:'3px', padding:'2px 6px' },
            '.cm-button': { background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:'3px', padding:'2px 8px', cursor:'pointer' },
          }),
          EditorView.updateListener.of(u => {
            if (u.docChanged && !syncing.current) onChange(u.state.doc.toString())
            if (u.selectionSet || u.docChanged) {
              const word = getInstWord(u.state, u.state.selection.main.head)
              cursorCb.current?.(word && INST_HELP[word] ? word : null)
            }
          }),
          EditorView.domEventHandlers({
            click(e, view) {
              if (!e.ctrlKey) return false
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos == null) return false
              const word = getInstWord(view.state, pos)
              if (word && INST_HELP[word]) { detailCb.current?.(word); return true }
              return false
            },
            contextmenu(e, view) {
              if (!onRunToRef.current || !lineAddrRef?.current) return false
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos == null) return false
              const lineNum = view.state.doc.lineAt(pos).number
              const addr = lineAddrRef.current.get(lineNum)
              if (addr === undefined) return false
              e.preventDefault()
              setEditorCtx({ addr, x: e.clientX, y: e.clientY })
              return true
            },
          }),
        ],
      }),
      parent: elRef.current,
    })
    viewRef.current = view
    if (gotoRef) gotoRef.current = (lineNum, labelName) => {
      try {
        if (labelName) {
          const text = view.state.doc.toString()
          const escaped = labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const m = new RegExp(`(^|\\n)[\\t ]*(${escaped})[\\t ]*:`, 'im').exec(text)
          if (m) {
            const nameIdx = m.index + m[0].indexOf(m[2])
            view.dispatch({ selection: { anchor: nameIdx, head: nameIdx + m[2].length }, effects: EditorView.scrollIntoView(nameIdx, { y: 'center' }) })
            return
          }
        }
        const line = view.state.doc.line(lineNum)
        view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
      } catch {}
    }
    return () => view.destroy()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync value from outside (example load) without re-creating the editor
  const lastVal = useRef(value)
  useEffect(() => {
    if (!viewRef.current || value === lastVal.current) return
    lastVal.current = value
    const view = viewRef.current
    if (view.state.doc.toString() === value) return
    syncing.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: 0 },
      effects: EditorView.scrollIntoView(0),
    })
    syncing.current = false
  }, [value])

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: themeConf.current.reconfigure(EditorView.theme({}, { dark: theme !== 'light' }))
      })
    }
  }, [theme])

  useEffect(() => {
    if (!editorCtx) return
    const close = () => setEditorCtx(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [editorCtx])

  return (
    <div style={{ position:'relative', height:'100%' }}>
      <div ref={elRef} className="editor-inner" />
      {editorCtx && (
        <div className="ctx-menu" style={{ left: editorCtx.x, top: editorCtx.y }}
          onMouseDown={e => e.stopPropagation()}>
          <button className="ctx-menu-item" onClick={() => { onRunToRef.current?.(editorCtx.addr); setEditorCtx(null) }}>
            ▶ Run to {hex4(editorCtx.addr)}H
          </button>
        </div>
      )}
    </div>
  )
}

function useCopy() {
  const [copied, setCopied] = useState(null)
  const copy = useCallback((text) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(text)
    setTimeout(() => setCopied(null), 1200)
  }, [])
  return [copied, copy]
}

function useCollapsible(key, defaultCollapsed = false) {
  const sk = 'panel_collapsed_' + key
  const [collapsed, setCollapsed] = useState(() => {
    try { const s = localStorage.getItem(sk); return s !== null ? s === 'true' : defaultCollapsed }
    catch { return defaultCollapsed }
  })
  const toggle = useCallback(() => setCollapsed(v => {
    const next = !v
    try { localStorage.setItem(sk, next) } catch {}
    return next
  }), [sk])
  return [collapsed, toggle]
}

function RegPanel({ regs, prev, onJump, regBase, onRegBase, onEdit, onShowDialog }) {
  const [collapsed, toggleCollapsed] = useCollapsible('reg', false)
  const p = prev || {}

  function EditableRow({ name, val, prevVal, regKey, is16 }) {
    const [editing, setEditing] = useState(false)
    const [buf, setBuf] = useState('')
    const [copied, copy] = useCopy()
    const changed = prevVal !== undefined && val !== prevVal

    function commit() {
      const radix = regBase === 'bin' ? 2 : regBase === 'dec' ? 10 : 16
      const n = parseInt(buf, radix)
      if (!isNaN(n)) {
        if (regKey === 'pc') {
          onShowDialog?.({
            type: 'confirm',
            title: 'Move PC',
            message: `Move instruction pointer to ${hex4(n)}H?\nThe next step will execute from that address.`,
            onConfirm: () => { sim.simSetRegisters({ [regKey]: n }); onEdit(); },
            onCancel: () => setEditing(false)
          })
          return
        }
        sim.simSetRegisters({ [regKey]: n })
        onEdit()
      }
      setEditing(false)
    }

    if (editing) return (
      <div className={`reg-row${is16 ? ' wide' : ''}${changed ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <input autoFocus className="reg-edit-input"
          value={buf} onChange={e => setBuf(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
      </div>
    )
    const displayVal = is16 ? fmtWord(val, regBase) : fmtByte(val, regBase)
    return (
      <div className={`reg-row${is16 ? ' wide clickable' : ' clickable'}${changed ? ' changed' : ''}`}
           title={is16 ? `Jump memory to ${hex4(val)}H  (click to edit, right-click to copy)` : 'Click to edit, right-click to copy'}
           onClick={() => { if (is16) onJump(val & 0xFFF0); setBuf(displayVal); setEditing(true) }}
           onContextMenu={e => { e.preventDefault(); copy(displayVal) }}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{copied !== null ? '✓' : displayVal}</span>
        {regBase === 'hex' && copied === null && <span className="reg-dec">{val}</span>}
      </div>
    )
  }

  // Paired cell: two 8-bit registers side-by-side
  function PairCell({ name, val, prevVal, regKey }) {
    const [editing, setEditing] = useState(false)
    const [buf, setBuf] = useState('')
    const [copied, copy] = useCopy()
    const changed = prevVal !== undefined && val !== prevVal

    function commit() {
      const radix = regBase === 'bin' ? 2 : regBase === 'dec' ? 10 : 16
      const n = parseInt(buf, radix)
      if (!isNaN(n)) { sim.simSetRegisters({ [regKey]: n }); onEdit() }
      setEditing(false)
    }

    if (editing) return (
      <div className={`reg-pair-cell${changed ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <input autoFocus className="reg-edit-input reg-pair-input"
          value={buf} onChange={e => setBuf(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
      </div>
    )
    const displayVal = fmtByte(val, regBase)
    return (
      <div className={`reg-pair-cell clickable${changed ? ' changed' : ''}`}
           title="Click to edit, right-click to copy"
           onClick={() => { setBuf(displayVal); setEditing(true) }}
           onContextMenu={e => { e.preventDefault(); copy(displayVal) }}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{copied !== null ? '✓' : displayVal}</span>
        {regBase === 'hex' && copied === null && <span className="reg-dec">{val}</span>}
      </div>
    )
  }

  const nextBase = BASE_CYCLE[(BASE_CYCLE.indexOf(regBase) + 1) % 3]

  return (
    <div className="panel reg-panel">
      <div className={`panel-hd collapsible`} onClick={toggleCollapsed}>
        <span className="panel-icon">🧠</span>REGISTERS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <button className="reg-base-btn" onClick={() => onRegBase(nextBase)}
            title="Toggle display: hex / dec / bin">{regBase.toUpperCase()}</button>
          <PanelHelp panel="REGISTERS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <>
        <EditableRow name="A" val={regs.a} prevVal={p.a} regKey="a" />
        <div className="reg-bits">
          {[7,6,5,4,3,2,1,0].map(bit => (
            <div key={bit} className={`reg-bit${(regs.a>>bit)&1 ? ' reg-bit-on' : ''}`}
                 title={`bit ${bit} — click to toggle`}
                 onClick={() => { const v = regs.a ^ (1<<bit); sim.simSetRegisters({a:v}); onEdit() }}>
              <div className="reg-bit-lbl">{bit}</div>
              <div className="reg-bit-val">{(regs.a>>bit)&1}</div>
            </div>
          ))}
        </div>
        <div className="reg-pair-row">
          <PairCell name="B" val={regs.b} prevVal={p.b} regKey="b" />
          <PairCell name="C" val={regs.c} prevVal={p.c} regKey="c" />
        </div>
        <div className="reg-pair-row">
          <PairCell name="D" val={regs.d} prevVal={p.d} regKey="d" />
          <PairCell name="E" val={regs.e} prevVal={p.e} regKey="e" />
        </div>
        <div className="reg-pair-row">
          <PairCell name="H" val={regs.h} prevVal={p.h} regKey="h" />
          <PairCell name="L" val={regs.l} prevVal={p.l} regKey="l" />
        </div>
        <div className="reg-sep" />
        <EditableRow name="PC" val={regs.pc} prevVal={p.pc} regKey="pc" is16 />
        <EditableRow name="SP" val={regs.sp} prevVal={p.sp} regKey="sp" is16 />
      </>}
    </div>
  )
}

// ── Register pairs panel ─────────────────────────────────────────────────
const PAIR_DEFS = [
  { name: 'BC', hi: 'b', lo: 'c' },
  { name: 'DE', hi: 'd', lo: 'e' },
  { name: 'HL', hi: 'h', lo: 'l' },
]

function PairPanel({ regs, prev, onJump, onEdit, regBase, onRegBase, onMemoryEdited }) {
  const [collapsed, toggleCollapsed] = useCollapsible('pairs', true)
  const [editing, setEditing] = useState(null)  // { key, field: 'addr'|'content' }
  const [buf, setBuf] = useState('')
  const p = prev || {}

  function startEdit(key, field, initial) {
    setEditing({ key, field })
    setBuf(initial)
  }

  function commitEdit() {
    if (!editing) return
    const { key, field } = editing
    const def = PAIR_DEFS.find(d => d.name === key)
    if (!def) { setEditing(null); return }
    const addr = (regs[def.hi] << 8) | regs[def.lo]
    const n = parseInt(buf, 16)
    if (!isNaN(n)) {
      if (field === 'addr') {
        sim.simSetRegisters({ [def.hi]: (n >> 8) & 0xFF, [def.lo]: n & 0xFF })
      } else {
        sim.simWriteByte(addr, n & 0xFF)
        onMemoryEdited?.()
      }
      onEdit()
    }
    setEditing(null)
  }

  return (
    <div className="panel reg-panel">
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span className="panel-icon">🔗</span>REGISTER PAIRS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="REGISTER PAIRS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <><div className="pair-col-hdr">
        <span />
        <span>ADDR</span>
        <span>CONTENT</span>
      </div>
      {PAIR_DEFS.map(({ name, hi, lo }) => {
        const val     = (regs[hi] << 8) | regs[lo]
        const prevVal = p[hi] !== undefined ? (p[hi] << 8) | p[lo] : undefined
        const mem     = sim.simGetMemory(val, 1)[0] ?? 0
        const changed = prevVal !== undefined && val !== prevVal
        const editAddr    = editing?.key === name && editing?.field === 'addr'
        const editContent = editing?.key === name && editing?.field === 'content'
        return (
          <div key={name} className={`pair-row${changed ? ' changed' : ''}${regBase === 'bin' ? ' bin' : ''}`}>
            <span className="reg-name">{name}</span>
            {editAddr
              ? <input autoFocus className="reg-edit-input pair-edit-input" value={buf}
                  onChange={e => setBuf(e.target.value.toUpperCase())}
                  onFocus={e => e.target.select()}
                  onFocus={e => e.target.select()}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key==='Enter') commitEdit(); if (e.key==='Escape') setEditing(null) }} />
              : <span className="pair-addr"
                  onClick={() => { onJump(val & 0xFFF0); startEdit(name, 'addr', hex4(val)) }}
                  title={`${hex4(val)}H — click to edit pair address, jump memory`}>
                  {fmtWord(val, regBase)}
                </span>
            }
            {editContent
              ? <input autoFocus className="reg-edit-input pair-edit-input" value={buf}
                  onChange={e => setBuf(e.target.value.toUpperCase())}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key==='Enter') commitEdit(); if (e.key==='Escape') setEditing(null) }} />
              : <span className="pair-content"
                  onClick={() => startEdit(name, 'content', hex2(mem))}
                  title={`mem[${hex4(val)}H] = ${hex2(mem)}H — click to edit`}>
                  {fmtByte(mem, regBase)}
                </span>
            }
          </div>
        )
      })}</>}
    </div>
  )
}

// ── Flags panel ──────────────────────────────────────────────────────────
function FlagPanel({ regs }) {
  const [collapsed, toggleCollapsed] = useCollapsible('flags', false)
  const FLAGS = [
    { label:'S',  key:'flagS',  title:'Sign — result was negative' },
    { label:'Z',  key:'flagZ',  title:'Zero — result was zero' },
    { label:'AC', key:'flagAC', title:'Auxiliary Carry — carry from bit 3' },
    { label:'P',  key:'flagP',  title:'Parity — even number of 1-bits' },
    { label:'CY', key:'flagCY', title:'Carry — result overflowed' },
  ]
  return (
    <div className="panel flag-panel">
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span className="panel-icon">🚩</span>FLAGS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="FLAGS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <div className="flags-row">
        {FLAGS.map(f => (
          <div key={f.key} className={`flag${regs[f.key] ? ' flag-on' : ''}`} title={f.title}>
            <div className="flag-lbl">{f.label}</div>
            <div className="flag-val">{regs[f.key]}</div>
          </div>
        ))}
      </div>}
    </div>
  )
}

// ── Disassembly panel ────────────────────────────────────────────────────
function DisasmPanel({ regs, breakpoints, onToggleBp, onClearAllBps, onSetCondition, onGotoLine, buildId, pcFlash, onRunTo, symbols, onJumpMem, hitcnts, maxHit }) {
  const [viewStart, setViewStart] = useState(() => regs.pc)
  const [ctxMenu, setCtxMenu]     = useState(null)   // {addr, x, y}
  const [followPC, setFollowPC]   = useState(true)
  const [addrInput, setAddrInput] = useState('')
  const [showBpList, setShowBpList] = useState(false)
  const curRowRef = useRef(null)

  const addrToLabel = useMemo(() => {
    const m = new Map()
    for (const [name, addr] of Object.entries(symbols || {})) m.set(addr, name)
    return m
  }, [symbols])

  const lines = useMemo(() => {
    const out = []
    let addr = viewStart
    for (let i = 0; i < 100 && addr <= 0xFFFF; i++) {
      const d = sim.simDisassemble(addr)
      out.push({ addr, ...d })
      addr += Math.max(1, d.len)
    }
    return out
  }, [viewStart, buildId])

  const hoveredRef  = useRef(false)
  const listRef     = useRef(null)
  const linesRef    = useRef(lines)
  const addrIdxRef  = useRef([])  // complete instruction address table, rebuilt on each build
  const ignorePcScrollRef = useRef(false)
  useEffect(() => { linesRef.current = lines }, [lines])

  // Build a complete address index by scanning all memory from 0 on each build.
  // Uninitialized RAM is 0x00 (NOP, 1 byte) so alignment from address 0 is always correct.
  useEffect(() => {
    const idx = []
    let addr = 0
    while (addr <= 0xFFFF) { idx.push(addr); const d = sim.simDisassemble(addr); addr += Math.max(1, d.len) }
    addrIdxRef.current = idx
  }, [buildId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Binary search: largest table index whose address value <= addr
  const findIdx = useCallback((addr) => {
    const idx = addrIdxRef.current
    let lo = 0, hi = idx.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (idx[mid] <= addr) lo = mid; else hi = mid - 1 }
    return lo
  }, [])

  useEffect(() => { setViewStart(regs.pc) }, [buildId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!followPC) return
    const ls = linesRef.current
    if (!ls.length) return
    const lo = ls[0].addr
    const hi = ls[ls.length - 1].addr
    if (regs.pc >= lo && regs.pc <= hi) {
      // Only scroll if PC is not already fully visible (e.g., if it's at the very edge)
      // or if ignorePcScrollRef is false (meaning user hasn't scrolled manually)
      if (!ignorePcScrollRef.current || (regs.pc < lo + 2 || regs.pc > hi - 2)) curRowRef.current?.scrollIntoView({ block: 'nearest' })
    } else if (regs.pc > hi && regs.pc - hi <= 6) {
      setViewStart(vs => { const i = findIdx(vs); return addrIdxRef.current[Math.min(addrIdxRef.current.length - 1, i + 1)] })
    } else {
      setViewStart(regs.pc)
    }
  }, [regs.pc, followPC]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

  useEffect(() => {
    const handler = (e) => {
      if (!hoveredRef.current || listRef.current === null) return
      const ls = linesRef.current
      const idx = addrIdxRef.current
      if (idx.length === 0) return

      const step = (vs, delta) => {
        const i = findIdx(vs)
        return idx[Math.max(0, Math.min(idx.length - 1, i + delta))]
      }
      const pageRows = listRef.current ? Math.max(1, Math.floor(listRef.current.clientHeight / 20) - 1) : 15

      // Detect manual scrolling and disable followPC
      let manualScroll = false
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setViewStart(vs => step(vs, 1)); manualScroll = true
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setViewStart(vs => step(vs, -1)); manualScroll = true
      } else if (e.key === 'PageDown') {
        e.preventDefault(); setViewStart(vs => step(vs, pageRows)); manualScroll = true
      } else if (e.key === 'PageUp') {
        e.preventDefault(); setViewStart(vs => step(vs, -pageRows)); manualScroll = true
      } else if (e.key === 'Home') {
        e.preventDefault(); setViewStart(0); manualScroll = true
      } else if (e.key === 'End') {
        e.preventDefault(); setViewStart(idx[idx.length - 1] || 0xFF00); manualScroll = true
      }
      if (manualScroll) {
        setFollowPC(false)
        ignorePcScrollRef.current = true // Indicate user is actively scrolling
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const bpList = useMemo(() => [...breakpoints.keys()].sort((a,b) => a-b), [breakpoints])

  return (
    <div className="panel disasm-panel">
      <div className="panel-hd">
        <span className="panel-icon">📋</span>DISASSEMBLY
        <div className="panel-hd-right">
          <input className="disasm-addr-input" placeholder="addr" value={addrInput}
            onChange={e => setAddrInput(e.target.value.toUpperCase())}
            onFocus={e => e.target.select()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = parseInt(addrInput, 16)
                if (!isNaN(v)) { setViewStart(v & 0xFFFF); setFollowPC(false) }
                setAddrInput(''); ignorePcScrollRef.current = true
              }
              if (e.key === 'Escape') setAddrInput('')
            }}
            title="Jump to hex address (Enter)" />
          <button className={`reg-base-btn${followPC ? ' active' : ''}`}
            onClick={() => setFollowPC(f => !f)}
            title={followPC ? 'Following PC — click to unlock' : 'Not following PC — click to lock'}>
            {followPC ? 'PC↓' : 'PC·'}
          </button>
          <PanelHelp panel="DISASSEMBLY" />
        </div>
      </div>
      <div className="disasm-list" ref={listRef}
        onWheel={e => {
          if (!listRef.current) return
          const idx = addrIdxRef.current
          if (idx.length === 0) return
          
          setFollowPC(false)
          ignorePcScrollRef.current = true

          const { scrollTop, scrollHeight, clientHeight } = listRef.current
          if (e.deltaY < 0 && scrollTop <= 1) {
            e.preventDefault()
            setViewStart(vs => idx[Math.max(0, findIdx(vs) - 3)])
          } else if (e.deltaY > 0 && scrollTop + clientHeight >= scrollHeight - 1) {
            e.preventDefault()
            setViewStart(vs => idx[Math.min(idx.length - 1, findIdx(vs) + 3)])
          }
        }}
        onMouseEnter={() => { hoveredRef.current = true }}
        onMouseLeave={() => { hoveredRef.current = false }}>
        {lines.map(row => {
          const cur   = row.addr === regs.pc
          const bp    = breakpoints.has(row.addr)
          const cond  = breakpoints.get(row.addr) ?? null
          const label = addrToLabel.get(row.addr)
          return (
            <div key={cur ? `cur-${regs.pc}-${pcFlash}` : row.addr}>
            {label && (
              <div className="disasm-label"
                onClick={() => { onJumpMem?.(row.addr & 0xFFF0); onGotoLine?.(row.addr, label) }}
                title={`${label}: at ${hex4(row.addr)}H — click to jump memory + editor`}>
                {label}:
              </div>
            )}
            <div
              ref={cur ? curRowRef : null}
              className={`disasm-row${cur ? ' cur' : ''}${bp ? ' bp' : ''}${row.mnem === 'ASSERT' ? ' assert' : ''}`}
              onClick={() => onGotoLine?.(row.addr)}
              onContextMenu={e => { e.preventDefault(); setCtxMenu({ addr: row.addr, x: e.clientX, y: e.clientY }) }}
            >
              <span className="disasm-bp"
                title={bp ? (cond ? `Condition: ${cond} — right-click to edit` : 'Breakpoint — right-click to add condition') : 'Click to set breakpoint'}
                onClick={e => { e.stopPropagation(); onToggleBp(row.addr) }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); bp && onSetCondition?.(row.addr) }}
              >
                {bp ? (cond ? '◆' : '●') : '·'}
              </span>
              <span className="disasm-heat"
                title={maxHit > 0 && hitcnts?.has(row.addr) ? `${hitcnts.get(row.addr).toLocaleString()} hits` : undefined}
                style={{opacity: maxHit > 0 && hitcnts?.has(row.addr) ? Math.max(0.15, hitcnts.get(row.addr) / maxHit) : 0}} />
              <span className="disasm-text">{row.text}</span>
              {cond && bp && <span className="disasm-cond">{cond}</span>}
              {row.cycles > 0 && <span className="disasm-cycles">{row.cycles}T</span>}
              <span className="disasm-hitcnt" title={maxHit > 0 && hitcnts?.has(row.addr) ? "Execution count" : undefined}>
                {maxHit > 0 && hitcnts?.has(row.addr) ? fmtCount(hitcnts.get(row.addr)) : ''}
              </span>
              {cur && <span className="disasm-pc-arrow">◀</span>}
            </div>
            </div>
          )
        })}
      </div>

      {bpList.length > 0 && (
        <div className="bp-list-wrap">
          <div className="bp-list-hd" onClick={() => setShowBpList(s => !s)}>
            <span>● BREAKPOINTS ({bpList.length})</span>
            <span style={{display:'flex', alignItems:'center', gap:6}}>
              <button className="bp-list-del" title="Clear all breakpoints"
                onClick={e => { e.stopPropagation(); onClearAllBps() }}
                style={{fontSize:10, padding:'1px 6px'}}>✕ All</button>
              {showBpList ? '▴' : '▾'}
            </span>
          </div>
          {showBpList && (
            <div className="bp-list">
              {bpList.map(addr => {
                const cond = breakpoints.get(addr)
                return (
                  <div key={addr} className="bp-list-row">
                    <span className="bp-list-addr"
                      onClick={() => { setViewStart(addr); setFollowPC(false) }}
                      title="Click to jump disassembly here">
                      {hex4(addr)}H
                    </span>
                    {cond && <span className="bp-list-cond" title={cond}>{cond}</span>}
                    <button className="bp-list-del" title="Remove breakpoint"
                      onClick={() => onToggleBp(addr)}>✕</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}>
          <button className="ctx-menu-item" onClick={() => { onRunTo?.(ctxMenu.addr); setCtxMenu(null) }}>
            ▶ Run to {hex4(ctxMenu.addr)}H
          </button>
          <button className="ctx-menu-item" onClick={() => { onToggleBp(ctxMenu.addr); setCtxMenu(null) }}>
            {breakpoints.has(ctxMenu.addr) ? '○ Remove BP' : '● Set BP'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Memory dump panel ────────────────────────────────────────────────────
function MemPanel({ memStart, onJump, regs, buildId, changedAddrs, programRegion, presetAddrs, onMemoryEdited, onShowDialog }) {
  const [mem, setMem] = useState(new Uint8Array(128))
  const [followPC, setFollowPC] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editBuf, setEditBuf] = useState('')
  const [rows, setRows] = useState(8)
  const [addrBuf, setAddrBuf] = useState(hex4(memStart))
  const [cursor, setCursor] = useState(memStart)
  const [showSearch, setShowSearch] = useState(false)
  const [showFill, setShowFill]     = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [searchVal, setSearchVal]   = useState('')
  const [searchMatches, setSearchMatches] = useState([])
  const [searchIdx, setSearchIdx]   = useState(0)
  const [fillFrom, setFillFrom]     = useState('')
  const [fillTo, setFillTo]         = useState('')
  const [fillVal, setFillVal]       = useState('')
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo]     = useState('')
  const [searchRan, setSearchRan]   = useState(false)
  const addrFocused = useRef(false)
  const COLS = 16
  const scrollRef = useRef(null)
  const panelRef  = useRef(null)

  const searchMatchSet  = useMemo(() => new Set(searchMatches), [searchMatches])
  const previewSet = useMemo(() => {
    let fromStr, toStr
    if (showFill) { fromStr = fillFrom; toStr = fillTo }
    else if (showExport) { fromStr = exportFrom; toStr = exportTo }
    else return new Set()
    const from = parseInt(fromStr, 16), to = parseInt(toStr, 16)
    if (isNaN(from) || isNaN(to)) return new Set()
    const start = Math.min(from, to) & 0xFFFF
    const end   = Math.min(Math.max(from, to) & 0xFFFF, 0xFFFF)
    const s = new Set()
    for (let a = start; a <= end; a++) s.add(a)
    return s
  }, [showFill, fillFrom, fillTo, showExport, exportFrom, exportTo])

  useEffect(() => { if (!addrFocused.current) setAddrBuf(hex4(memStart)) }, [memStart])

  function manualJump(addr) {
    setFollowPC(false)
    onJump(addr)
  }

  useEffect(() => {
    if (!followPC) return
    const visEnd = memStart + COLS * rows - 1
    if (regs.pc < memStart || regs.pc > visEnd) {
      onJump((regs.pc >> 4) << 4)
    }
  }, [regs.pc, followPC, memStart, rows, onJump])

  // When viewport jumps externally (address input, ◀/▶), clamp cursor into view
  useEffect(() => {
    setCursor(c => {
      const visEnd = memStart + COLS * rows - 1
      return (c < memStart || c > visEnd) ? memStart : c
    })
  }, [memStart, rows])

  useEffect(() => {
    if (!scrollRef.current) return
    const ro = new ResizeObserver(([e]) => {
      setRows(r => { const n = Math.max(2, Math.floor((e.contentRect.height - 22) / 20)); return n !== r ? n : r })
    })
    ro.observe(scrollRef.current)
    return () => ro.disconnect()
  }, [])

  function onHandleMouseDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const targetEl = panelRef.current.closest('.mem-watch-row') || panelRef.current
    const startH = targetEl.getBoundingClientRect().height
    function onMove(ev) {
      targetEl.style.height = Math.max(80, startH + (startY - ev.clientY)) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function refresh() { setMem(sim.simGetMemory(memStart, COLS * rows)) }
  useEffect(refresh, [memStart, regs.pc, rows, buildId])

  function commit(addr, raw) {
    const v = parseInt(raw, 16)
    if (!isNaN(v)) {
      sim.simWriteByte(addr, v)
      onMemoryEdited?.()
    }
    setEditing(null)
    refresh()
  }

  function moveCursor(delta) {
    const next = Math.max(0, Math.min(0xFFFF, cursor + delta))
    setCursor(next)
    const visEnd = memStart + COLS * rows - 1
    if (next < memStart) {
      manualJump((next >> 4) << 4)
    } else if (next > visEnd) {
      manualJump(Math.max(0, ((next >> 4) << 4) - COLS * (rows - 1)))
    }
  }

  function onPanelKey(e) {
    if (addrFocused.current || editing !== null) return
    const pageSize = COLS * rows
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveCursor(-COLS) }
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveCursor(+COLS) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); moveCursor(-1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor(+1) }
    if (e.key === 'PageUp')     { e.preventDefault(); moveCursor(-pageSize) }
    if (e.key === 'PageDown')   { e.preventDefault(); moveCursor(+pageSize) }
  }

  function runSearch() {
    const v = parseInt(searchVal, 16)
    if (isNaN(v)) return
    const allMem = sim.simGetMemory(0, 0x10000)
    const matches = []
    for (let i = 0; i < allMem.length; i++) {
      if (allMem[i] === (v & 0xFF)) matches.push(i)
    }
    setSearchMatches(matches)
    setSearchIdx(0)
    setSearchRan(true)
    if (matches.length > 0) manualJump(matches[0] & 0xFFF0)
  }

  function searchNav(dir) {
    if (searchMatches.length === 0) return
    const idx = (searchIdx + dir + searchMatches.length) % searchMatches.length
    setSearchIdx(idx)
    manualJump(searchMatches[idx] & 0xFFF0)
  }

  function runFill() {
    const from = parseInt(fillFrom, 16)
    const to   = parseInt(fillTo, 16)
    const val  = parseInt(fillVal, 16)
    if (isNaN(from) || isNaN(to) || isNaN(val)) return
    const start = Math.min(from, to) & 0xFFFF
    const end   = Math.min(Math.max(from, to) & 0xFFFF, 0xFFFF)
    for (let a = start; a <= end; a++) sim.simWriteByte(a, val & 0xFF)
    refresh()
    onMemoryEdited?.()
  }

  function runExport() {
    const from = parseInt(exportFrom, 16)
    const to   = parseInt(exportTo, 16)
    if (isNaN(from) || isNaN(to)) return
    const start = Math.min(from, to) & 0xFFFF
    const end   = Math.min(Math.max(from, to) & 0xFFFF, 0xFFFF)
    const len = end - start + 1
    const buf = sim.simGetMemory(start, len)
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `memory_${hex4(start)}-${hex4(end)}.bin`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  function clearMemory() {
    onShowDialog?.({
      type: 'confirm',
      title: 'Clear Memory',
      message: 'Clear all memory? This will overwrite everything with 00H.',
      confirmText: 'Clear',
      onConfirm: () => {
        for (let i = 0; i <= 0xFFFF; i++) sim.simWriteByte(i, 0)
        refresh()
        onMemoryEdited?.()
      }
    })
  }

  return (
    <div className="panel mem-panel" ref={panelRef} tabIndex={0} onKeyDown={onPanelKey}>
      <div className="mem-resize-handle" onMouseDown={onHandleMouseDown} />
      <div className="panel-hd">
        <span className="panel-icon">💾</span>MEMORY
        <div className="panel-hd-right">
        <span className="mem-ctrl">
          <button className={`mem-btn${followPC ? ' mem-btn-active' : ''}`} style={{ width: 42 }}
            title={followPC ? 'Following PC — click to unlock' : 'Not following PC — click to lock'}
            onClick={() => setFollowPC(f => !f)}>
            {followPC ? 'PC↓' : 'PC·'}
          </button>
          <button className="mem-btn" title="Back 4 pages" onClick={() => manualJump(Math.max(0, memStart - COLS*rows*4))}>«</button>
          <button className="mem-btn" onClick={() => manualJump(Math.max(0, memStart - COLS*rows))}>◀</button>
          <input
            className="mem-cur-addr"
            value={addrBuf}
            maxLength={4}
            spellCheck={false}
            onChange={e => setAddrBuf(e.target.value.toUpperCase())}
            onFocus={e => { addrFocused.current = true; e.target.select() }}
            onBlur={() => { addrFocused.current = false; setAddrBuf(hex4(memStart)) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { const v = parseInt(addrBuf, 16); if (!isNaN(v)) manualJump(v & 0xFFF0); e.target.blur() }
              if (e.key === 'Escape') { setAddrBuf(hex4(memStart)); e.target.blur() }
            }}
          />
        <button className="mem-btn" onClick={() => manualJump(Math.min(0xFFF0, memStart + COLS*rows))}>▶</button>
        <button className="mem-btn" title="Forward 4 pages" onClick={() => manualJump(Math.min(0xFFF0, memStart + COLS*rows*4))}>»</button>
        </span>
        <span style={{width:8, flexShrink:0}} />
        <button className={`mem-btn${showSearch ? ' mem-btn-active' : ''}`}
          title="Find byte in memory (toggle)"
          onClick={() => { setShowSearch(s => !s); setShowFill(false); setShowExport(false) }}>🔍</button>
        <button className={`mem-btn${showFill ? ' mem-btn-active' : ''}`}
          title="Fill memory range (toggle)"
          onClick={() => { setShowFill(s => !s); setShowSearch(false); setShowExport(false) }}>⊞</button>
        <button className={`mem-btn${showExport ? ' mem-btn-active' : ''}`}
          title="Export memory range (toggle)"
          onClick={() => { setShowExport(s => !s); setShowSearch(false); setShowFill(false) }}>⬇</button>
      <button className="mem-btn" title="Clear all memory" onClick={clearMemory}>🗑</button>
        <PanelHelp panel="MEMORY" wide />
        </div>
      </div>
      {showSearch && (
        <div className="mem-toolbar mem-toolbar-search">
          <span className="mem-toolbar-lbl">FIND</span>
          <input className="mem-toolbar-input" placeholder="FF" maxLength={2} style={{width:36}}
            autoFocus
            value={searchVal}
            onChange={e => { setSearchVal(e.target.value.toUpperCase()); setSearchRan(false) }}
            onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
          />
          <button className="mem-btn" onClick={runSearch}>Search</button>
          {searchMatches.length > 0 && <>
            <button className="mem-btn" onClick={() => searchNav(-1)}>◀</button>
            <button className="mem-btn" onClick={() => searchNav(+1)}>▶</button>
            <span className="mem-toolbar-count">{searchIdx+1}/{searchMatches.length}</span>
          </>}
          {searchRan && searchMatches.length === 0 && <span className="mem-toolbar-count">no match</span>}
        </div>
      )}
      {showFill && (
        <div className="mem-toolbar mem-toolbar-fill">
          <span className="mem-toolbar-lbl">FILL</span>
          <input className="mem-toolbar-input" placeholder="0000" maxLength={4} style={{width:46}}
            autoFocus
            value={fillFrom} onChange={e => setFillFrom(e.target.value.toUpperCase())} title="Start address" />
          <span className="mem-toolbar-lbl">–</span>
          <input className="mem-toolbar-input" placeholder="00FF" maxLength={4} style={{width:46}}
            value={fillTo} onChange={e => setFillTo(e.target.value.toUpperCase())} title="End address" />
          <span className="mem-toolbar-lbl">with value</span>
          <input className="mem-toolbar-input" placeholder="00" maxLength={2} style={{width:30}}
            value={fillVal} onChange={e => setFillVal(e.target.value.toUpperCase())} title="Fill value" />
          <button className="mem-btn" onClick={runFill}>Fill range</button>
        </div>
      )}
      {showExport && (
        <div className="mem-toolbar mem-toolbar-fill">
          <span className="mem-toolbar-lbl">EXPORT</span>
          <input className="mem-toolbar-input" placeholder="0000" maxLength={4} style={{width:46}}
            autoFocus
            value={exportFrom} onChange={e => setExportFrom(e.target.value.toUpperCase())} title="Start address" />
          <span className="mem-toolbar-lbl">–</span>
          <input className="mem-toolbar-input" placeholder="00FF" maxLength={4} style={{width:46}}
            value={exportTo} onChange={e => setExportTo(e.target.value.toUpperCase())} title="End address" />
          <button className="mem-btn" onClick={runExport}>Download .bin</button>
        </div>
      )}
      <div className="mem-scroll" ref={scrollRef}
        onWheel={e => { e.preventDefault(); const delta = e.deltaY > 0 ? COLS : -COLS; manualJump(Math.max(0, Math.min(0xFFF0, memStart + delta))) }}>
        <table className="mem-tbl">
          <thead>
            <tr>
              <th className="mem-th-addr"></th>
              {Array.from({length:COLS},(_,i)=><th key={i} className="mem-th">{hex2(i)}</th>)}
              <th className="mem-th-ascii mobile-hidden" style={{ paddingLeft: 16, textAlign: 'left' }}>ASCII</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({length:rows},(_,row)=>{
              const base = memStart + row*COLS
              let ascii = ''
              return (
                <tr key={row}>
                  <td className="mem-row-addr">{hex4(base)}</td>
                  {Array.from({length:COLS},(_,col)=>{
                    const addr = base + col
                    const val  = mem[row*COLS+col] ?? 0
                    const isPC     = addr === regs.pc
                    const isSP     = addr === regs.sp
                    const isCursor = addr === cursor
                    const isCode     = !isPC && !isSP && programRegion && addr >= programRegion.start && addr < programRegion.end
                    const isPreset   = !isPC && !isSP && !isCode && presetAddrs?.has(addr)
                    const isMatchCur = searchMatches.length > 0 && addr === searchMatches[searchIdx]
                    const isMatch    = !isMatchCur && searchMatchSet.has(addr)
                    const isFillPrev = !isPC && !isSP && !isMatchCur && !isMatch && previewSet.has(addr)
                    ascii += (val >= 0x20 && val <= 0x7E) ? String.fromCharCode(val) : '.'
                    if (editing === addr)
                      return (
                        <td key={col} className="mem-cell editing">
                          <input autoFocus maxLength={2} value={editBuf}
                            onChange={e=>setEditBuf(e.target.value.toUpperCase())}
                            onFocus={e => e.target.select()}
                            onBlur={()=>commit(addr,editBuf)}
                            onKeyDown={e=>{if(e.key==='Enter')commit(addr,editBuf);if(e.key==='Escape')setEditing(null)}}
                          />
                        </td>
                      )
                    return (
                      <td key={col}
                        className={`mem-cell${isPC?' mem-pc':''}${isSP?' mem-sp':''}${isCode?' mem-code':''}${isPreset?' mem-preset':''}${isCursor?' mem-cursor':''}${val?' mem-nz':''}${changedAddrs?.has(addr)?' mem-diff':''}${isMatchCur?' mem-match-cur':''}${isMatch?' mem-match':''}${isFillPrev?' mem-fill-prev':''}`}
                        title={`${hex4(addr)}: ${hex2(val)}H = ${val}`}
                        onClick={()=>setCursor(addr)}
                        onDoubleClick={()=>{setEditing(addr);setEditBuf(hex2(val))}}
                      >{hex2(val)}</td>
                    )
                  })}
                  <td className="mem-cell-ascii mobile-hidden" style={{ paddingLeft: 16, letterSpacing: '1px', opacity: 0.6, whiteSpace: 'pre' }}>{ascii}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mem-legend">
        <span className="legend-pc">■</span> PC &nbsp;
        <span className="legend-sp">■</span> SP &nbsp;
        <span className="legend-code">■</span> Code &nbsp;
        <span className="legend-preset">■</span> Data &nbsp;
        <span className="legend-tip">double-click to edit · click + ↑↓ PgUp/Dn to scroll</span>
      </div>
    </div>
  )
}

// ── Calculator panel ─────────────────────────────────────────────────────
const CALC_BASES = [
  { key: 'bin', label: 'BIN', radix:  2, maxLen: 16, placeholder: '1111111111111111' },
  { key: 'oct', label: 'OCT', radix:  8, maxLen:  6, placeholder: '177777' },
  { key: 'dec', label: 'DEC', radix: 10, maxLen:  5, placeholder: '65535' },
  { key: 'hex', label: 'HEX', radix: 16, maxLen:  4, placeholder: 'FFFF' },
]
const EMPTY_VALS = { bin: '', oct: '', dec: '', hex: '' }

function CalcFloat({ onClose }) {
  const [vals, setVals] = useState(EMPTY_VALS)
  const [pos,  setPos]  = useState({ x: Math.max(0, window.innerWidth / 2 - 120), y: 100 })
  const posRef = useRef(pos)

  function update(key, raw) {
    const { radix } = CALC_BASES.find(b => b.key === key)
    const input = key === 'hex' ? raw.toUpperCase() : raw
    if (input === '') { setVals(EMPTY_VALS); return }
    const n = parseInt(input, radix)
    if (isNaN(n) || n < 0 || n > 0xFFFF) { setVals(v => ({ ...v, [key]: input })); return }
    setVals({ bin: n.toString(2), oct: n.toString(8), dec: String(n), hex: n.toString(16).toUpperCase(), [key]: input })
  }

  function onDragDown(e) {
    if (e.target.closest('button')) return
    e.preventDefault()
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y
    function onMove(ev) {
      const p = { x: ev.clientX - ox, y: Math.max(0, ev.clientY - oy) }
      posRef.current = p; setPos(p)
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="calc-float" style={{ left: pos.x, top: pos.y }}>
      <div className="calc-float-hd" onMouseDown={onDragDown}>
        <span><span className="panel-icon">🖩</span>CALCULATOR</span>
        <button className="calc-float-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="calc-body">
        {CALC_BASES.map(({ key, label, maxLen, placeholder }) => (
          <div key={key} className="calc-row">
            <span className="calc-lbl">{label}</span>
            <input className="calc-input" value={vals[key]} maxLength={maxLen}
              placeholder={placeholder} spellCheck={false}
              onChange={e => update(key, e.target.value)}
              onFocus={e => e.target.select()} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── AI chat panel ────────────────────────────────────────────────────────
const CHAT_SYSTEM = `You are an expert assistant embedded in an Intel 8085 microprocessor simulator. Help users with 8085 assembly language programming, instruction behaviour, register and flag effects, debugging, memory addressing, and general computer architecture. When showing code use 8085 assembly syntax. Be concise and practical.`

function ChatPanel({ regs, src, onClose }) {
  const [apiKey,      setApiKey]      = useState(() => localStorage.getItem('ant_key') || '')
  const [keyDraft,    setKeyDraft]    = useState('')
  const [setupOpen,   setSetupOpen]   = useState(!localStorage.getItem('ant_key'))
  const [messages,    setMessages]    = useState([])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [pos,         setPos]         = useState({ x: Math.max(0, window.innerWidth / 2 - 170), y: 150 })
  const posRef     = useRef(pos)
  const scrollRef  = useRef(null)
  const inputRef   = useRef(null)

  function onDragDown(e) {
    if (e.target.closest('button') || e.target.closest('input')) return
    e.preventDefault()
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y
    function onMove(ev) {
      const p = { x: ev.clientX - ox, y: Math.max(0, ev.clientY - oy) }
      posRef.current = p; setPos(p)
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  function saveKey() {
    const k = keyDraft.trim()
    if (!k) return
    localStorage.setItem('ant_key', k)
    setApiKey(k); setSetupOpen(false); setKeyDraft('')
  }

  function clearKey() {
    localStorage.removeItem('ant_key')
    setApiKey(''); setSetupOpen(true); setMessages([])
  }

  function buildContext() {
    if (!regs) return ''
    const h2 = v => v.toString(16).toUpperCase().padStart(2, '0')
    const h4 = v => v.toString(16).toUpperCase().padStart(4, '0')
    const f = regs.flags ?? 0
    const flags = [
      `S=${(f>>7)&1}`, `Z=${(f>>6)&1}`, `AC=${(f>>4)&1}`,
      `P=${(f>>2)&1}`, `CY=${f&1}`
    ].join(' ')
    const bc = (regs.b << 8) | regs.c
    const de = (regs.d << 8) | regs.e
    const hl = (regs.h << 8) | regs.l
    const lines = [
      `\n\n--- Current simulator state ---`,
      `Registers: A=${h2(regs.a)} B=${h2(regs.b)} C=${h2(regs.c)} D=${h2(regs.d)} E=${h2(regs.e)} H=${h2(regs.h)} L=${h2(regs.l)}`,
      `Pairs: BC=${h4(bc)}  DE=${h4(de)}  HL=${h4(hl)}`,
      `PC=${h4(regs.pc)}  SP=${h4(regs.sp)}`,
      `Flags: ${flags}`,
    ]
    if (src?.trim()) lines.push(`\nCurrent editor source:\n\`\`\`\n${src.trim()}\n\`\`\``)
    return lines.join('\n')
  }

  async function send() {
    const text = input.trim()
    if (!text || loading || !apiKey) return
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next); setInput(''); setLoading(true)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: CHAT_SYSTEM + buildContext(),
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
      setMessages(m => [...m, { role: 'assistant', content: data.content?.[0]?.text || '' }])
    } catch (err) {
      setMessages(m => [...m, { role: 'error', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="chat-float" style={{ left: pos.x, top: pos.y }}>
      <div className="chat-float-hd" onMouseDown={onDragDown}>
        <span><span className="panel-icon">🤖</span>AI ASSISTANT</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button className="reg-base-btn" onClick={() => setSetupOpen(o => !o)} title="API key settings">⚙</button>
          <PanelHelp panel="AI ASSISTANT" />
          <button className="chat-float-close" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {setupOpen && (
        <div className="chat-key-setup">
          <p className="chat-key-hint">Your Anthropic API key — stored only in this browser, never sent to any server other than Anthropic.</p>
          <div className="chat-key-row">
            <input className="chat-key-input" type="password" placeholder="sk-ant-…"
              value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveKey()} />
            <button className="btn btn-xs" onClick={saveKey}>Save</button>
          </div>
          {apiKey && <button className="btn btn-xs" onClick={clearKey}>Clear key</button>}
          <a className="chat-key-link" href="https://console.anthropic.com" target="_blank" rel="noreferrer">Get a key at console.anthropic.com →</a>
        </div>
      )}

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !setupOpen &&
          <div className="chat-empty">Ask anything about 8085 assembly…</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-bubble">{m.content}</div>
          </div>
        ))}
        {loading && <div className="chat-msg chat-msg-assistant"><div className="chat-bubble chat-loading">…</div></div>}
      </div>

      {!setupOpen && (
        <div className="chat-input-row">
          <input ref={inputRef} className="chat-input" placeholder="Ask about 8085…"
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button className="btn btn-xs" onClick={send} disabled={loading || !input.trim()}>Send</button>
        </div>
      )}
    </div>
  )
}

// ── Stack panel ──────────────────────────────────────────────────────────
function StackPanel({ regs, regBase, onRegBase }) {
  const [collapsed, toggleCollapsed] = useCollapsible('stack', false)
  const panelRef = useRef(null)
  const entries = useMemo(() => {
    const out = []
    for (let i = 0; i < 64; i++) {
      const a = (regs.sp + i*2) & 0xFFFF
      out.push({ addr: a, val: sim.simReadByte(a) | (sim.simReadByte(a+1)<<8) })
    }
    return out
  }, [regs.sp])

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY, startH = panelRef.current.getBoundingClientRect().height
    const onMove = ev => {
      const colBottom = panelRef.current.parentElement.getBoundingClientRect().bottom
      const panelTop = panelRef.current.getBoundingClientRect().top
      const maxH = Math.max(72, colBottom - panelTop - 32)
      panelRef.current.style.height = Math.max(72, Math.min(maxH, startH + (ev.clientY - startY))) + 'px'
    }
    const onUp   = ()  => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel stack-panel" ref={panelRef}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span className="panel-icon">📚</span>STACK
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <code className="sp-val">SP={hex4(regs.sp)}</code>
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="STACK" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <>
        <div className="stack-body">
          {entries.length === 0
            ? <div className="stack-empty">empty</div>
            : entries.map((e,i) => (
              <div key={e.addr} className={`stack-row${i===0?' stack-top':''}`}>
                <span className="stack-addr">{hex4(e.addr)}</span>
                <span className="stack-sep">→</span>
                <span className="stack-val">{fmtWord(e.val, regBase)}</span>
              </div>
            ))
          }
        </div>
        <div className="stack-resize-handle" onMouseDown={onResizeDown} />
      </>}
    </div>
  )
}

// ── LED display ──────────────────────────────────────────────────────────
function LedDisplay({ leds }) {
  const LABELS = ['ST1','ST0','A3','A2','A1','A0','D1','D0']
  return (
    <div className="panel led-panel">
      <div className="panel-hd"><span className="panel-icon">💡</span>LED DISPLAY<PanelHelp panel="LED DISPLAY" /></div>
      <div className="led-digits">
        {leds.map((v,i) => (
          <div key={i} className={`led-digit${i < 2 ? ' led-digit-st' : ''}`}>
            <SevenSeg value={v} />
            <div className="led-val">{v.toString(16).toUpperCase().padStart(2,'0')}</div>
            <div className="led-lbl">{LABELS[i]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Execution trace panel ────────────────────────────────────────────────
function TracePanel({ trace, onClear }) {
  const [collapsed, toggleCollapsed] = useCollapsible('trace', true)
  const bodyRef = useRef(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [trace])

  return (
    <div className="panel trace-panel">
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span className="panel-icon">📜</span>TRACE
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <button className="reg-base-btn" onClick={onClear} title="Clear trace">✕</button>
          <PanelHelp panel="TRACE" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <div className="trace-body" ref={bodyRef}>
        {trace.length === 0
          ? <div className="trace-empty">Step or run to record execution</div>
          : trace.map((e, i) => (
            <div key={i} className="trace-row">
              <span className="trace-addr">{hex4(e.addr)}</span>
              <span className="trace-text">{e.text.replace(/^[0-9A-Fa-f]{4}\s+(?:[0-9A-Fa-f]{2}\s+)+/, '').trim()}</span>
              {e.changedKeys.length > 0 &&
                <span className="trace-delta">
                  {e.changedKeys.map(k => {
                    const FLAG_SHORT = { flagS:'S', flagZ:'Z', flagAC:'AC', flagP:'P', flagCY:'CY' }
                    const isFlag = !!FLAG_SHORT[k]
                    const is16 = TRACE_REG16.has(k)
                    const name = FLAG_SHORT[k] ?? k.toUpperCase()
                    const val  = isFlag ? e.regs[k] : fmtTraceVal(k, e.regs[k])
                    const color = isFlag ? '#ff8a66' : is16 ? '#c792ea' : '#82aaff'
                    return <span key={k} style={{ color, marginRight: 7 }}>{name}={val}</span>
                  })}
                </span>
              }
            </div>
          ))
        }
      </div>}
    </div>
  )
}

// ── Watch panel ──────────────────────────────────────────────────────────
function CallStackPanel({ callStack, onJump }) {
  const [collapsed, toggleCollapsed] = useCollapsible('callstack', true)
  return (
    <div className="panel callstack-panel">
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span className="panel-icon">📞</span>CALL STACK
        {callStack.length > 0 && <span className="callstack-depth">{callStack.length}</span>}
        <span className="panel-chevron" style={{marginLeft:'auto'}}>{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (callStack.length === 0
        ? <div className="callstack-empty">— empty (step to populate) —</div>
        : <div className="callstack-list">
            {[...callStack].reverse().map((frame, i) => (
              <div key={i} className={`callstack-row${i === 0 ? ' callstack-top' : ''}`}>
                <span className="callstack-target" title="Target address" onClick={() => onJump(frame.targetAddr)}>{hex4(frame.targetAddr)}H</span>
                <span className="callstack-arrow">←</span>
                <span className="callstack-site" title="Call site" onClick={() => onJump(frame.callAddr)}>{hex4(frame.callAddr)}H</span>
                <span className="callstack-ret" title="Return address">ret:{hex4(frame.retAddr)}H</span>
              </div>
            ))}
          </div>
      )}
    </div>
  )
}

function WatchPanel({ watches, regs, onAdd, onRemove, regBase, onRegBase, dataBps, onToggleBreak }) {
  const [input, setInput] = useState('')
  const PAIR_KEYS = { bc: ['b','c'], de: ['d','e'], hl: ['h','l'] }
  const REG_NAMES = new Set(['a','b','c','d','e','h','l','pc','sp','flags','bc','de','hl'])

  function getValue(w) {
    if (w.type === 'reg') {
      const p = PAIR_KEYS[w.key]
      if (p) return (regs[p[0]] << 8) | regs[p[1]]
      return regs[w.key] ?? 0
    }
    return sim.simReadByte(w.addr)
  }

  function is16(w) {
    return w.type === 'mem' || ['pc','sp','bc','de','hl'].includes(w.key)
  }

  function addWatch() {
    const s = input.trim().toLowerCase()
    if (!s) return
    if (REG_NAMES.has(s)) {
      if (!watches.find(w => w.type === 'reg' && w.key === s))
        onAdd({ type: 'reg', key: s })
    } else {
      const addr = parseInt(s.replace(/h$/,''), 16)
      if (!isNaN(addr))
        onAdd({ type: 'mem', addr: addr & 0xFFFF })
    }
    setInput('')
  }

  return (
    <div className="panel watch-panel">
      <div className="panel-hd">
        <span className="panel-icon">👁</span>WATCH
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="WATCH" />
        </div>
      </div>
      <div className="watch-add-row">
        <input className="watch-input" value={input} placeholder="A  BC  0200H…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addWatch()} />
        <button className="btn btn-xs" onClick={addWatch}>+</button>
      </div>
      <div className="watch-body">
        {watches.length === 0
          ? <div className="watch-empty">Type a register or address above</div>
          : watches.map((w, i) => {
              const v = getValue(w)
              const label = w.type === 'reg' ? w.key.toUpperCase() : hex4(w.addr) + 'H'
              const isBrk = w.type === 'mem' && dataBps?.has(w.addr)
              return (
                <div key={i} className="watch-row">
                  <span className="watch-label">{label}</span>
                  <span className="watch-val">{is16(w) ? fmtWord(v, regBase) : fmtByte(v, regBase)}</span>
                  {(regBase||'hex') === 'hex' && <span className="watch-dec">{v}</span>}
                  {w.type === 'mem' && (
                    <button className={`watch-brk${isBrk ? ' active' : ''}`}
                      title={isBrk ? 'Break on write: ON — click to disable' : 'Break on write: OFF — click to enable'}
                      onClick={() => onToggleBreak?.(w.addr)}>W</button>
                  )}
                  <button className="watch-rm" onClick={() => onRemove(i)}>✕</button>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}

// ── Console output panel ─────────────────────────────────────────────────
function ConsolePanel({ output, port, onSetPort, onClear }) {
  const bodyRef  = useRef(null)
  const [portBuf, setPortBuf] = useState(() => port.toString(16).toUpperCase().padStart(2,'0'))

  useEffect(() => { setPortBuf(port.toString(16).toUpperCase().padStart(2,'0')) }, [port])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [output])

  function commitPort() {
    const n = parseInt(portBuf.replace(/h$/i,''), 16)
    if (!isNaN(n) && n >= 0 && n <= 255) onSetPort(n & 0xFF)
  }

  const lines = output.split('\n')

  return (
    <div className="panel console-panel">
      <div className="panel-hd">
        <span className="panel-icon">🖥</span>CONSOLE
        <div className="panel-hd-right">
          <span className="console-port-label">OUT</span>
          <input className="console-port-input" value={portBuf} maxLength={2}
            onChange={e => setPortBuf(e.target.value.toUpperCase())}
            onBlur={commitPort}
            onKeyDown={e => { if (e.key === 'Enter') { commitPort(); e.target.blur() } }}
            title="Port number (hex) — bytes written here appear as ASCII text" />
          <span className="console-port-label">H</span>
          <button className="reg-base-btn" onClick={onClear} title="Clear console output">✕</button>
          <PanelHelp panel="CONSOLE" />
        </div>
      </div>
      <div className="console-body" ref={bodyRef}>
        {output === ''
          ? <span className="console-empty">No output yet — use OUT {portBuf}H to print ASCII characters</span>
          : lines.map((line, i) => (
              <div key={i} className="console-line">{line || ' '}</div>
            ))
        }
      </div>
    </div>
  )
}

// ── I/O port panel ───────────────────────────────────────────────────────
function IOPortPanel({ outputPorts, inputPresets, onSetInput, onRemoveInput, keyQueue, onEnqueueKeys, onClearKeyQueue, sid, sod, onSetSID }) {
  const [collapsed, toggleCollapsed] = useCollapsible('ioports', true)
  const [portBuf, setPortBuf] = useState('')
  const [valBuf,  setValBuf]  = useState('')
  const [kbdBuf,  setKbdBuf]  = useState('')

  function addPreset() {
    const port = parseInt(portBuf.replace(/h$/i,''), 16)
    const val  = parseInt(valBuf.replace(/h$/i,''), 16)
    if (isNaN(port) || port < 0 || port > 255) return
    onSetInput(port & 0xFF, isNaN(val) ? 0 : val & 0xFF)
    setPortBuf(''); setValBuf('')
  }

  function submitKbd() {
    if (!kbdBuf) return
    onEnqueueKeys(kbdBuf)
    setKbdBuf('')
  }

  return (
    <div className="panel ioport-panel">
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span className="panel-icon">🔌</span>I/O PORTS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="I/O PORTS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <>
      <div className="ioport-section-hd">OUTPUT  <span className="ioport-hint">written by OUT</span></div>
      {outputPorts.length === 0
        ? <div className="ioport-empty">No OUT executed yet</div>
        : outputPorts.map(({ port, val }) => (
          <div key={port} className="ioport-row">
            <span className="ioport-port">{hex2(port)}H</span>
            <span className="ioport-arrow">→</span>
            <span className="ioport-val">{hex2(val)}H</span>
            <span className="ioport-dec">{val}</span>
          </div>
        ))
      }

      <div className="ioport-section-hd" style={{marginTop:'6px'}}>INPUT  <span className="ioport-hint">returned by IN</span></div>
      <div className="ioport-add-row">
        <input className="ioport-input" placeholder="port (hex)" value={portBuf}
          onChange={e => setPortBuf(e.target.value.toUpperCase())}
          onKeyDown={e => e.key==='Enter' && addPreset()} maxLength={3} />
        <input className="ioport-input" placeholder="value" value={valBuf}
          onChange={e => setValBuf(e.target.value.toUpperCase())}
          onKeyDown={e => e.key==='Enter' && addPreset()} maxLength={3} />
        <button className="btn btn-xs" onClick={addPreset}>+</button>
      </div>
      {inputPresets.length === 0
        ? <div className="ioport-empty">No input ports set</div>
        : inputPresets.map(({ port, val }) => (
          <div key={port} className="ioport-row">
            <span className="ioport-port">{hex2(port)}H</span>
            <span className="ioport-arrow">←</span>
            <span className="ioport-val">{hex2(val)}H</span>
            <span className="ioport-dec">{val}</span>
            <button className="watch-rm" onClick={() => onRemoveInput(port)}>✕</button>
          </div>
        ))
      }

      <div className="ioport-section-hd" style={{marginTop:'6px'}}>SERIAL  <span className="ioport-hint">SID/SOD pins</span></div>
      <div className="ioport-serial-row">
        <span className="ioport-serial-lbl">SID (in):</span>
        <button className={`btn btn-xs ioport-serial-btn${sid ? ' active' : ''}`}
          onClick={() => onSetSID(sid ? 0 : 1)} title="Toggle Serial Input Data line">{sid ? '1' : '0'}</button>
        <span className="ioport-serial-lbl" style={{marginLeft:'10px'}}>SOD (out):</span>
        <span className={`ioport-serial-val${sod ? ' active' : ''}`} title="Serial Output Data line">{sod ? '1' : '0'}</span>
      </div>

      <div className="ioport-section-hd" style={{marginTop:'6px'}}>KEYBOARD  <span className="ioport-hint">C=01H syscall input</span></div>
      <div className="ioport-add-row">
        <input className="ioport-kbd-input" placeholder="type to enqueue…"
          value={kbdBuf} onChange={e => setKbdBuf(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submitKbd()} />
        <button className="btn btn-xs" onClick={submitKbd}>+</button>
      </div>
      {keyQueue.length === 0
        ? <div className="ioport-empty">Queue empty</div>
        : <div className="ioport-kbd-chips">
            {keyQueue.map((ch, i) => (
              <span key={i} className="ioport-kbd-chip"
                title={`0x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0')}`}>
                {ch === ' ' ? '·' : ch}
              </span>
            ))}
            <button className="watch-rm" onClick={onClearKeyQueue} title="Clear queue">✕</button>
          </div>
      }
      </>}
    </div>
  )
}

// ── 8255 PPI Panel ────────────────────────────────────────────────────────
function PPI8255Panel({ outputPorts, inputPresets, onSetInput, onClose }) {
  const [pos,  setPos]  = useState({ x: Math.max(0, window.innerWidth - 260), y: 420 })
  const posRef = useRef(pos)

  function onDragDown(e) {
    if (e.target.closest('button')) return
    e.preventDefault()
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y
    function onMove(ev) {
      const p = { x: ev.clientX - ox, y: Math.max(0, ev.clientY - oy) }
      posRef.current = p; setPos(p)
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  const basePort = 0x00;
  const ctrlPort = basePort + 3;

  const outMap = new Map(outputPorts.map(p => [p.port, p.val]))
  const inMap = new Map(inputPresets.map(p => [p.port, p.val]))

  // Default Control Word is 9BH (10011011) - Mode 0, All ports set as Input
  const ctrlVal = outMap.get(ctrlPort) ?? 0x9B;
  const isModeSet = (ctrlVal & 0x80) !== 0;
  const dirA = isModeSet && (ctrlVal & 0x10) ? 'IN' : 'OUT';
  const dirCU = isModeSet && (ctrlVal & 0x08) ? 'IN' : 'OUT';
  const dirB = isModeSet && (ctrlVal & 0x02) ? 'IN' : 'OUT';
  const dirCL = isModeSet && (ctrlVal & 0x01) ? 'IN' : 'OUT';

  function renderPort(name, port, dir) {
    const val = dir === 'OUT' ? (outMap.get(port) ?? 0) : (inMap.get(port) ?? 0);
    return (
      <div className="ppi-port">
        <div className="ppi-port-hd">
          <span>PORT {name} <span className="ppi-port-addr">({hex2(port)}H)</span></span>
          <span className={`ppi-dir ppi-dir-${dir.toLowerCase()}`}>{dir}</span>
        </div>
        <div className="ppi-bits">
          {[7,6,5,4,3,2,1,0].map(bit => {
            const isOn = (val >> bit) & 1;
            return (
              <div key={bit} className={`ppi-bit${isOn ? ' on' : ''}${dir==='IN'?' clickable':''}`}
                onClick={() => { if (dir === 'IN') onSetInput(port, val ^ (1 << bit)) }}>
                {isOn ? '1' : '0'}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderPortC(port, dirU, dirL) {
    const valOut = outMap.get(port) ?? 0;
    const valIn = inMap.get(port) ?? 0;
    return (
      <div className="ppi-port">
        <div className="ppi-port-hd">
          <span>PORT C <span className="ppi-port-addr">({hex2(port)}H)</span></span>
          <span className="ppi-dir"><span className={`ppi-dir-${dirU.toLowerCase()}`}>U:{dirU}</span> <span className={`ppi-dir-${dirL.toLowerCase()}`}>L:{dirL}</span></span>
        </div>
        <div className="ppi-bits">
          {[7,6,5,4,3,2,1,0].map(bit => {
            const dir = bit >= 4 ? dirU : dirL;
            const val = dir === 'OUT' ? valOut : valIn;
            const isOn = (val >> bit) & 1;
            return (
              <div key={bit} className={`ppi-bit${isOn ? ' on' : ''}${dir==='IN'?' clickable':''}`}
                onClick={() => { if (dir === 'IN') onSetInput(port, valIn ^ (1 << bit)) }}>
                {isOn ? '1' : '0'}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="ppi-float" style={{ left: pos.x, top: pos.y }}>
      <div className="ppi-float-hd" onMouseDown={onDragDown}>
        <span><span className="panel-icon">🕹️</span>8255 PPI</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <PanelHelp panel="8255 PPI" />
          <button className="ppi-float-close" onClick={onClose} title="Close">✕</button>
        </div>
      </div>
      <div className="ppi-body">
        <div className="ppi-ctrl-row">
          <span>CTRL WORD ({hex2(ctrlPort)}H):</span>
          <span className="ppi-ctrl-val">{hex2(ctrlVal)}H</span>
        </div>
        {renderPort('A', basePort + 0, dirA)}
        {renderPort('B', basePort + 1, dirB)}
        {renderPortC(basePort + 2, dirCU, dirCL)}
      </div>
    </div>
  )
}

// ── 8253 PIT Panel ────────────────────────────────────────────────────────
function PIT8253Panel({ outputPorts, onClose }) {
  const [pos,  setPos]  = useState({ x: Math.max(0, window.innerWidth - 480), y: 420 })
  const posRef = useRef(pos)

  function onDragDown(e) {
    if (e.target.closest('button')) return
    e.preventDefault()
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y
    function onMove(ev) {
      const p = { x: ev.clientX - ox, y: Math.max(0, ev.clientY - oy) }
      posRef.current = p; setPos(p)
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  const outMap = new Map(outputPorts.map(p => [p.port, p.val]))
  const ctrlVal = outMap.get(0x13) ?? 0

  const sc = (ctrlVal >> 6) & 3
  const mode = (ctrlVal >> 1) & 7

  function renderCounter(idx, port) {
    const val = outMap.get(port) ?? 0
    const isActive = sc === idx
    return (
      <div className="ppi-port" style={{ borderColor: isActive ? 'var(--accent)' : 'var(--border)' }}>
        <div className="ppi-port-hd">
          <span>COUNTER {idx} <span className="ppi-port-addr">({hex2(port)}H)</span></span>
          {isActive && <span className="ppi-dir ppi-dir-out">MODE {mode}</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>VAL:</span>
          <span style={{ fontSize: 14, color: isActive ? 'var(--accent)' : 'var(--text2)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{hex2(val)}H</span>
        </div>
      </div>
    )
  }

  return (
    <div className="ppi-float" style={{ left: pos.x, top: pos.y }}>
      <div className="ppi-float-hd" onMouseDown={onDragDown}>
        <span><span className="panel-icon">⏱️</span>8253 PIT</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <PanelHelp panel="8253 PIT" />
          <button className="ppi-float-close" onClick={onClose} title="Close">✕</button>
        </div>
      </div>
      <div className="ppi-body">
        <div className="ppi-ctrl-row"><span>CTRL WORD (13H):</span><span className="ppi-ctrl-val">{hex2(ctrlVal)}H</span></div>
        {renderCounter(0, 0x10)}
        {renderCounter(1, 0x11)}
        {renderCounter(2, 0x12)}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Control Word at 13H decodes mode. Loads hit 10H-12H.</div>
      </div>
    </div>
  )
}

// ── Audio Output Panel ──────────────────────────────────────────────────
function AudioPanel({ running, onShowDialog }) {
  const [collapsed, toggleCollapsed] = useCollapsible('audio', false)
  const [enabled, setEnabled] = useState(false)
  const [volume, setVolume] = useState(0.05)
  const [displayVal, setDisplayVal] = useState(0)
  const audioRef = useRef(null) // holds { ctx, osc, gain }
  const runningRef = useRef(running)
  const volRef = useRef(volume)

  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { volRef.current = volume }, [volume])

  function toggleAudio() {
    if (!enabled) {
      // Initialize AudioContext directly inside the click handler to bypass browser autoplay blocks
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) { onShowDialog?.({ type: 'alert', title: 'Audio', message: 'Web Audio API not supported.' }); return }
      if (!audioRef.current) {
        const ctx = new AudioCtx()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        gain.gain.value = 0 // Start completely muted
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        audioRef.current = { ctx, osc, gain }
      }
      const { ctx } = audioRef.current
      if (ctx.state === 'suspended') ctx.resume()
      setEnabled(true)
    } else {
      // Mute and suspend
      if (audioRef.current) {
        const { ctx, gain } = audioRef.current
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015)
        setTimeout(() => { if (audioRef.current?.ctx.state === 'running') audioRef.current.ctx.suspend() }, 50)
      }
      setEnabled(false)
      setDisplayVal(0)
    }
  }

  function playTestTone() {
    if (!enabled || !audioRef.current) return onShowDialog?.({ type: 'alert', title: 'Audio', message: 'Click ON first!' })
    const { gain, osc, ctx } = audioRef.current
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    setTimeout(() => { if (audioRef.current) gain.gain.setValueAtTime(0, audioRef.current.ctx.currentTime) }, 200)
  }

  useEffect(() => {
    if (!enabled || !audioRef.current) return
    const { ctx, osc, gain } = audioRef.current


    let lastVal = -1
    let lastRun = null
    let lastVol = -1

    const timer = setInterval(() => {
      const ports = sim.simGetOutputPorts()
      const val = ports.find(p => p.port === 0x40)?.val ?? 0
      const isRun = runningRef.current
      const curVol = volRef.current
      
      setDisplayVal(prev => (prev !== val ? val : prev))

      if (val !== lastVal || isRun !== lastRun || curVol !== lastVol) {
        try {
          osc.frequency.cancelScheduledValues(ctx.currentTime)
          gain.gain.cancelScheduledValues(ctx.currentTime)
        } catch (e) {}

        if (val > 0 && isRun) {
          const freq = 100 * Math.pow(2, val / 48)
          osc.frequency.setValueAtTime(freq, ctx.currentTime)
          gain.gain.setTargetAtTime(curVol, ctx.currentTime, 0.015) // Unmute
        } else {
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015) // Mute
        }
        lastVal = val
        lastRun = isRun
        lastVol = curVol
      }
    }, 16)


    return () => clearInterval(timer)
  }, [enabled])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        try { audioRef.current.osc.stop() } catch {}
        audioRef.current.osc.disconnect()
        audioRef.current.ctx.close()
      }
    }
  }, [])

  return (
    <div className="panel audio-panel">
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span><span className="panel-icon">🔊</span>AUDIO (PORT 40H)</span>
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="AUDIO OUTPUT" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="audio-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button className={`btn btn-xs ${enabled ? 'btn-run' : ''}`} onClick={toggleAudio}>
              {enabled ? 'ON' : 'OFF'}
            </button>
            <button className="btn btn-xs" onClick={playTestTone} title="Test your browser speakers">Test Tone</button>
            <input type="range" min="0" max="0.1" step="0.01" value={volume}
              onChange={e => setVolume(+e.target.value)}
              style={{ width: '60px', accentColor: 'var(--accent)', cursor: 'pointer' }}
              title="Volume" />
            <span style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
              VAL: <span style={{ color: 'var(--accent)' }}>{hex2(displayVal)}H</span>
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            OUT 40H &gt; 0 plays tone. Set Simulator Speed to <b>Fast</b> for best playback.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Memory Map Panel ────────────────────────────────────────────────────
function MemMapPanel({ regs, programRegion, presetAddrs }) {
  const [collapsed, toggleCollapsed] = useCollapsible('memmap', false)
  const [selectedInfo, setSelectedInfo] = useState('Click a region for details')

  // Group scattered preset addresses into contiguous visual chunks
  const dataRegions = useMemo(() => {
    if (!presetAddrs || presetAddrs.size === 0) return []
    const addrs = [...presetAddrs].sort((a,b) => a-b)
    const regions = []
    let cur = { start: addrs[0], end: addrs[0] }
    for (let i = 1; i < addrs.length; i++) {
      if (addrs[i] <= cur.end + 64) cur.end = addrs[i] // cluster close elements
      else { regions.push(cur); cur = { start: addrs[i], end: addrs[i] } }
    }
    regions.push(cur)
    return regions
  }, [presetAddrs])

  return (
    <div className="panel memmap-panel">
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span><span className="panel-icon">🗺️</span>MEMORY MAP</span>
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="MEMORY MAP" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="memmap-body">
          <div className="memmap-bar-container">
            <div className="memmap-bar">
              {programRegion && <div className="memmap-region memmap-code" style={{ top: `${(programRegion.start/65535)*100}%`, height: `${Math.max(0.5, ((programRegion.end-programRegion.start)/65535)*100)}%` }} onClick={() => setSelectedInfo(`Code: ${hex4(programRegion.start)}H - ${hex4(programRegion.end)}H`)} />}
              {dataRegions.map((r, i) => <div key={i} className="memmap-region memmap-data" style={{ top: `${(r.start/65535)*100}%`, height: `${Math.max(0.5, ((r.end-r.start)/65535)*100)}%` }} onClick={() => setSelectedInfo(`Data: ${hex4(r.start)}H - ${hex4(r.end)}H`)} />)}
              {regs.sp > 0 && <div className="memmap-region memmap-stack" style={{ top: `${(regs.sp/65535)*100}%`, height: `${((65536-regs.sp)/65535)*100}%` }} onClick={() => setSelectedInfo(`Stack: ${hex4(regs.sp)}H - FFFFH`)} />}
              <div className="memmap-marker memmap-pc" style={{ top: `${(regs.pc/65535)*100}%` }} onClick={() => setSelectedInfo(`PC: ${hex4(regs.pc)}H`)} />
            </div>
            <div className="memmap-labels"><div style={{top: '0%'}}>0000H</div><div style={{top: '100%', transform: 'translateY(-100%)'}}>FFFFH</div></div>
          </div>
          <div className="memmap-legend">
            <div className="memmap-legend-grid">
              <div><span className="memmap-swatch" style={{background: 'var(--tint-blue-code)', borderColor: 'rgba(64,144,255,.5)'}}/> CODE</div>
              <div><span className="memmap-swatch" style={{background: 'var(--tint-green-pre)', borderColor: 'rgba(74,240,160,.5)'}}/> DATA</div>
              <div><span className="memmap-swatch" style={{background: 'var(--tint-amber-sp)', borderColor: 'var(--amber)'}}/> STACK</div>
              <div><span className="memmap-swatch" style={{background: 'var(--tint-accent-pc)', borderColor: 'var(--accent)'}}/> PC</div>
            </div>
            <div style={{ marginTop: 8, padding: '4px 8px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 10, color: 'var(--text2)', minHeight: 24, display: 'flex', alignItems: 'center' }}>
              {selectedInfo}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Interrupt panel ──────────────────────────────────────────────────────
function IntPanel({ intState, onAssert, onDeassert }) {
  const [collapsed, toggleCollapsed] = useCollapsible('interrupts', true)
  const { iff, intMask, rst75ff, trapPend, rst65, rst55, intr } = intState
  const [intrRst, setIntrRst] = useState(7)

  const masked = bit => (intMask >> bit) & 1

  const rows = [
    { type:'TRAP',  label:'TRAP',    vec:'0024H', pulse:true,  bit:-1 },
    { type:'RST75', label:'RST 7.5', vec:'003CH', pulse:true,  bit:2  },
    { type:'RST65', label:'RST 6.5', vec:'0034H', pulse:false, bit:1  },
    { type:'RST55', label:'RST 5.5', vec:'002CH', pulse:false, bit:0  },
  ]
  const lineOn = { TRAP: trapPend, RST75: rst75ff, RST65: rst65, RST55: rst55, INTR: intr }

  return (
    <div className="panel int-panel">
      <div className="panel-hd collapsible" onClick={toggleCollapsed}>
        <span className="panel-icon">🔔</span>INTERRUPTS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="INTERRUPTS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <>
        <div className="int-iff">
          IFF <span className={`int-iff-val${iff ? ' int-iff-on' : ''}`}>{iff ? 'ENABLED' : 'DISABLED'}</span>
        </div>
        {rows.map(({ type, label, vec, pulse, bit }) => (
          <div key={type} className="int-row">
            {pulse
              ? <button className={`btn btn-xs int-btn${lineOn[type] ? ' int-pending' : ''}`}
                  onClick={() => onAssert(type)}>
                  {lineOn[type] ? 'PEND' : 'FIRE'}
                </button>
              : <button className={`btn btn-xs int-btn${lineOn[type] ? ' int-btn-on' : ''}`}
                  onClick={() => lineOn[type] ? onDeassert(type) : onAssert(type)}>
                  {lineOn[type] ? 'ON' : 'OFF'}
                </button>
            }
            <span className={`int-label${bit >= 0 && masked(bit) ? ' int-masked' : ''}`}>{label}</span>
            <span className="int-vec">{vec}</span>
            {bit >= 0 && masked(bit) && <span className="int-mask-tag">masked</span>}
          </div>
        ))}
        <div className="int-row">
          <button className={`btn btn-xs int-btn${intr ? ' int-btn-on' : ''}`}
            onClick={() => intr ? onDeassert('INTR') : onAssert('INTR', 0xC7 | (intrRst << 3))}>
            {intr ? 'ON' : 'OFF'}
          </button>
          <span className="int-label">INTR</span>
          <span className="int-vec">RST&nbsp;
            <select className="int-rst-sel" value={intrRst}
              onChange={e => setIntrRst(+e.target.value)}>
              {[0,1,2,3,4,5,6,7].map(n =>
                <option key={n} value={n}>{n} ({hex4(n*8)}H)</option>)}
            </select>
          </span>
        </div>
      </>}
    </div>
  )
}

// ── Example submenu ──────────────────────────────────────────────────────
function PanelsMenu({ panels, onToggle }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const dropRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = e => {
      if (!btnRef.current?.contains(e.target) && !dropRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  const toggle = () => {
    if (!open) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 230) })
    }
    setOpen(o => !o)
  }

  return (
    <>
      <button ref={btnRef} className="btn" onClick={toggle} title="Show/hide panels">
        🪟 Panels <span className="exmenu-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div ref={dropRef} className="bmenu-dropdown" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxHeight: '70vh', overflowY: 'auto' }}>
          {[
            ['regs','Registers'],['pairs','Reg Pairs'],['flags','Flags'],
            ['ints','Interrupts'],['io','I/O Ports'],['memmap','Mem Map'],
            ['audio','Audio'],['ppi','8255 PPI'],['pit','8253 PIT'],
            ['stack','Stack'],['callstack','Call Stack'],['trace','Trace'],
          ].map(([k, l]) => (
            <button key={k} className="bmenu-item" onClick={() => onToggle(k)}>
              <span style={{ display: 'inline-block', width: 16 }}>{panels[k] ? '✓' : ''}</span>{l}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function ExampleMenu({ onLoad }) {
  const [open, setOpen]           = useState(false)
  const [activeCat, setActiveCat] = useState(null)
  const [pos, setPos]             = useState({ top: 0, left: 0 })
  const btnRef  = useRef(null)
  const dropRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (!btnRef.current?.contains(e.target) && !dropRef.current?.contains(e.target)) {
        setOpen(false); setActiveCat(null)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler) }
  }, [open])

  const toggle = () => {
    if (!open) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 230) })
    }
    setOpen(o => !o)
  }

  return (
    <>
      <button ref={btnRef} className="btn exmenu-trigger" onClick={toggle}>
        Examples <span className="exmenu-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div ref={dropRef} className="exmenu-dropdown" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
          {Object.entries(EXAMPLES).map(([cat, programs], i) => (
            <div key={cat}>
              {['Basic', 'Memory', 'I/O'].includes(cat) && <hr className="exmenu-sep" />}
              <div
                className={`exmenu-cat${activeCat === cat ? ' exmenu-cat-active' : ''}`}
                onMouseEnter={() => setActiveCat(cat)}
                onClick={() => setActiveCat(activeCat === cat ? null : cat)}
              >
                <span>{cat}</span>
                <span className="exmenu-arrow">▶</span>
                {activeCat === cat && (
                  <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                    {Object.keys(programs).map(name => (
                      <button key={name} className="exmenu-sub-item"
                        onClick={() => { onLoad(`${cat}::${name}`); setOpen(false); setActiveCat(null) }}>
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>

  )
}

// ── Brand menu ───────────────────────────────────────────────────────────
function BrandMenu({ onShowWelcome, onShowShortcuts, onNew, onImport, onLoadFromDrive, onLoadFromGist, onExport, onExportHex, onExportBin, onSaveToDrive, onSaveAsToDrive, onSaveToGist, onShare, onCalc, onChat, memSize, onMemSize, engineMode, onEngineSwitch, engineSwitching, theme, onTheme, onSetTheme, crtBrightness, onCrtBrightness, crtContrast, onCrtContrast, crtGlitch, onCrtGlitch, onManageGithub, panels, onTogglePanel, activeView, onSetView, driveToken, onConnectDrive, onDriveDisconnect }) {
  const [open, setOpen] = useState(false);
  const [activeSub, setActiveSub] = useState(null);
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (!wrapRef.current?.contains(e.target)) {
        setOpen(false)
        setActiveSub(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function item(label, action) {
    return (
      <button className="bmenu-item" onClick={() => { action(); setOpen(false); setActiveSub(null) }}>
        {label}
      </button>
    )
  }

  return (
    <div className="bmenu-wrap" ref={wrapRef}>
      <button className="brand-chip bmenu-trigger" onClick={() => setOpen(o => !o)} title="Menu">
        <span className="brand-chevron">☰</span><span className="brand-name"> 8085</span>
      </button>
      {open &&
        <div className="bmenu-dropdown" style={{ overflow: 'visible' }} onMouseLeave={() => setActiveSub(null)}>
          <div className={`bmenu-item exmenu-cat bmenu-mobile-only ${activeSub === 'views' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('views')} onClick={() => setActiveSub(activeSub === 'views' ? null : 'views')}>
            <span>🖥  Views</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'views' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                {[['simulator','🖥','Simulator'],['challenges','🏆','Challenges'],['community','🌐','Community Gists']].map(([v,icon,label]) => (
                  <button key={v} className="exmenu-sub-item" onClick={() => { onSetView(v); setOpen(false); setActiveSub(null) }}>
                    <span style={{display:'inline-block',width:16}}>{activeView===v?'✓':''}</span>{icon} {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="bmenu-sep" />
          <div className={`bmenu-item exmenu-cat ${activeSub === 'import' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('import')} onClick={() => setActiveSub(activeSub === 'import' ? null : 'import')}>
            <span>⇡  Import</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'import' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                <button className="exmenu-sub-item" onClick={() => { onNew(); setOpen(false); setActiveSub(null); }}>📄 New file</button>
                <hr className="exmenu-sep" />
                <button className="exmenu-sub-item" onClick={() => { onImport(); setOpen(false); setActiveSub(null); }}>.asm / .85 source</button>
                <button className="exmenu-sub-item" onClick={() => { onImport(); setOpen(false); setActiveSub(null); }}>.hex / .bin image</button>
                <button className="exmenu-sub-item" onClick={() => { onLoadFromDrive(); setOpen(false); setActiveSub(null); }}>☁ Load from Google Drive</button>
                <button className="exmenu-sub-item" onClick={() => { onLoadFromGist(); setOpen(false); setActiveSub(null); }}>🐙 Load from GitHub Gist</button>
              </div>
            )}
          </div>

          <div className={`bmenu-item exmenu-cat ${activeSub === 'export' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('export')} onClick={() => setActiveSub(activeSub === 'export' ? null : 'export')}>
            <span>⇣  Export</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'export' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                <button className="exmenu-sub-item" onClick={() => { onExport(); setOpen(false); setActiveSub(null); }}>.asm source</button>
                <button className="exmenu-sub-item" onClick={() => { onExportHex(); setOpen(false); setActiveSub(null); }}>.hex (Intel HEX)</button>
                <button className="exmenu-sub-item" onClick={() => { onExportBin(); setOpen(false); setActiveSub(null); }}>.bin (raw binary)</button>
                <button className="exmenu-sub-item" onClick={() => { onSaveToDrive(); setOpen(false); setActiveSub(null); }}>☁ Save to Google Drive</button>
                {driveToken && <button className="exmenu-sub-item" onClick={() => { onSaveAsToDrive?.(); setOpen(false); setActiveSub(null); }}>☁ Save As to Google Drive…</button>}
                <button className="exmenu-sub-item" onClick={() => { onSaveToGist(); setOpen(false); setActiveSub(null); }}>🐙 Save to GitHub Gist</button>
                <button className="exmenu-sub-item" onClick={() => { onShare(); setOpen(false); setActiveSub(null); }}>⎘ Copy share link</button>
              </div>
            )}
          </div>
          <div className="bmenu-sep" />

          {driveToken ? (
            <div className={`bmenu-item exmenu-cat ${activeSub === 'drive' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('drive')} onClick={() => setActiveSub(activeSub === 'drive' ? null : 'drive')}>
              <span>☁  Drive ✓</span>
              <span className="exmenu-arrow">▶</span>
              {activeSub === 'drive' && (
                <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                  <button className="exmenu-sub-item" onClick={() => { onLoadFromDrive(); setOpen(false); setActiveSub(null); }}>📂 Load from Drive…</button>
                  <button className="exmenu-sub-item" onClick={() => { onSaveToDrive(); setOpen(false); setActiveSub(null); }}>💾 Save to Drive</button>
                  <button className="exmenu-sub-item" onClick={() => { onSaveAsToDrive?.(); setOpen(false); setActiveSub(null); }}>📝 Save As…</button>
                  <div className="bmenu-sep" />
                  <button className="exmenu-sub-item" style={{ color: 'var(--text3)' }} onClick={() => { onDriveDisconnect?.(); setOpen(false); setActiveSub(null); }}>🔌 Disconnect</button>
                </div>
              )}
            </div>
          ) : (
            <button className="bmenu-item" onClick={() => { onConnectDrive?.(); setOpen(false); setActiveSub(null); }}>☁  Connect to Google Drive</button>
          )}

          <div className={`bmenu-item exmenu-cat ${activeSub === 'tools' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('tools')} onClick={() => setActiveSub(activeSub === 'tools' ? null : 'tools')}>
            <span>🛠  Tools</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'tools' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                <button className="exmenu-sub-item" onClick={() => { onCalc(); setOpen(false); setActiveSub(null); }}>🖩 Calculator</button>
                <button className="exmenu-sub-item" onClick={() => { onChat(); setOpen(false); setActiveSub(null); }}>🤖 AI Assistant</button>
              </div>
            )}
          </div>

          <div className={`bmenu-item exmenu-cat ${activeSub === 'help' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('help')} onClick={() => setActiveSub(activeSub === 'help' ? null : 'help')}>
            <span>❓  Help &amp; Community</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'help' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                <button className="exmenu-sub-item" onClick={() => { onShowWelcome(); setOpen(false); setActiveSub(null); }}>📖 Welcome guide</button>
                <button className="exmenu-sub-item" onClick={() => { onShowShortcuts(); setOpen(false); setActiveSub(null); }}>⌨ Keyboard shortcuts</button>
                <hr className="exmenu-sep" />
                <button className="exmenu-sub-item" onClick={() => { window.open('https://github.com/selfmodify/sim8085wasm', '_blank'); setOpen(false); setActiveSub(null); }}>⭐ View on GitHub</button>
                <button className="exmenu-sub-item" onClick={() => { window.open('https://github.com/selfmodify/sim8085wasm/issues/new', '_blank'); setOpen(false); setActiveSub(null); }}>🐛 Report a Bug</button>
                <button className="exmenu-sub-item" onClick={() => { window.open('https://github.com/selfmodify/sim8085wasm/discussions', '_blank'); setOpen(false); setActiveSub(null); }}>💬 Ask a Question</button>
                <button className="exmenu-sub-item" onClick={() => { onManageGithub(); setOpen(false); setActiveSub(null); }}>🔑 Manage GitHub API Token</button>
                <hr className="exmenu-sep" />
                <button className="exmenu-sub-item" onClick={() => { window.open('./privacy.html', '_blank'); setOpen(false); setActiveSub(null); }}>🔒 Privacy Policy</button>
                <button className="exmenu-sub-item" onClick={() => { window.open('./terms.html', '_blank'); setOpen(false); setActiveSub(null); }}>📜 Terms of Service</button>
              </div>
            )}
          </div>

          <div className="bmenu-sep" />
          <div className={`bmenu-item exmenu-cat ${activeSub === 'theme' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('theme')} onClick={() => setActiveSub(activeSub === 'theme' ? null : 'theme')}>
            <span>🎨  Theme</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'theme' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                {[
                  { id: 'dark',  label: '🌙  Dark'  },
                  { id: 'dim',   label: '🌗  Dim'   },
                  { id: 'light', label: '☀︎  Light' },
                ].map(({ id, label }) => (
                  <button key={id} className="exmenu-sub-item"
                    style={{ color: theme === id ? 'var(--accent)' : undefined,
                             fontWeight: theme === id ? 700 : undefined }}
                    onClick={() => { onSetTheme(id); setOpen(false); setActiveSub(null) }}>
                    {label}
                  </button>
                ))}
                <hr className="exmenu-sep" />
                {[
                  { id: 'amber-mono', label: '🟡  Amber Monochrome' },
                  { id: 'gray-crt',   label: '⬜  Gray Retro CRT'   },
                  { id: 'green',      label: '🟢  Green CRT'        },
                  { id: 'turbo-c',    label: '🟦  Turbo C'          },
                ].map(({ id, label }) => (
                  <button key={id} className="exmenu-sub-item"
                    style={{ color: theme === id ? 'var(--accent)' : undefined,
                             fontWeight: theme === id ? 700 : undefined }}
                    onClick={() => { onSetTheme(id); setOpen(false); setActiveSub(null) }}>
                    {label}{theme === id ? '  ✓' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          {['amber-mono', 'gray-crt', 'green', 'turbo-c'].includes(theme) && (
            <>
              <div className="bmenu-setting">
                <span className="bmenu-setting-label">CRT Brightness</span>
                <input type="range" min="0.2" max="2.5" step="0.1" value={crtBrightness}
                  onChange={e => onCrtBrightness(+e.target.value)} className="speed-slider" style={{width:'80px'}}
                  onDoubleClick={() => onCrtBrightness(1)} title="Double-click to reset" />
              </div>
              <div className="bmenu-setting">
                <span className="bmenu-setting-label">CRT Contrast</span>
                <input type="range" min="0.2" max="3.0" step="0.1" value={crtContrast}
                  onChange={e => onCrtContrast(+e.target.value)} className="speed-slider" style={{width:'80px'}}
                  onDoubleClick={() => onCrtContrast(1)} title="Double-click to reset" />
              </div>
              <div className="bmenu-setting">
                <span className="bmenu-setting-label">CRT Interference</span>
                <button className={`btn btn-xs ${crtGlitch !== 'off' ? 'btn-run' : ''}`} onClick={() => onCrtGlitch()}>
                  {({off:'Off',flicker:'Flicker',static:'Static',vsync:'V-Sync',hsync:'H-Sync',chroma:'Chroma',chaos:'Chaos'})[crtGlitch] ?? 'Off'}
                </button>
              </div>
            </>
          )}
          <div className="bmenu-setting">
            <span className="bmenu-setting-label">RAM size</span>
            <select className="bmenu-setting-sel" value={memSize}
              onChange={e => { onMemSize(+e.target.value); setOpen(false) }}>
              <option value={16*1024}>16 KB</option>
              <option value={32*1024}>32 KB</option>
              <option value={64*1024}>64 KB</option>
            </select>
          </div>
          <div className="bmenu-setting">
            <span className="bmenu-setting-label">Engine</span>
            <span style={{display:'flex',gap:3}}>
              {['js','wasm'].map(m => (
                <button key={m} disabled={engineSwitching}
                  className={`bmenu-setting-sel`}
                  style={{
                    cursor: engineSwitching ? 'wait' : 'pointer',
                    borderColor: engineMode === m ? 'var(--accent)' : undefined,
                    color: engineMode === m ? 'var(--accent)' : undefined,
                    fontWeight: engineMode === m ? 700 : 400,
                  }}
                  onClick={() => { onEngineSwitch(m); setOpen(false) }}>
                  {m.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
          <div className="bmenu-mobile-hide bmenu-credits">
            <div>8085 Simulator</div>
            <div>Original: V. Kumar · 1995</div>
            <div>Web port: 2026</div>
          </div>
        </div>
      }
    </div>
  )
}

// ── Welcome modal ────────────────────────────────────────────────────────
const WELCOME_FEATURES = [
  { icon: '✏️', title: 'Editor',          desc: 'Write 8085 assembly with syntax highlighting and auto-indent. Ctrl+click any mnemonic for the full instruction reference. Use ASSERT to validate registers, flags, and memory inline — any failure halts with a clear error. Load from 20+ built-in examples across six categories.' },
  { icon: '▶',  title: 'Build & Run',     desc: 'F5 assembles, F7 steps one instruction, F9 runs/pauses, F6 resets. ⟲ Back undoes the last step. Eight speed modes from Crawl (1 step/tick) through Turbo++ to Warp, which runs flat-out until HLT with no mid-run UI overhead. Switch between the JS and WASM engine from the ☰ menu to compare throughput.' },
  { icon: '📋', title: 'Disassembly',     desc: 'Live disassembly follows the program counter. Click any row to toggle a breakpoint — execution pauses automatically when PC hits it.' },
  { icon: '🧠', title: 'CPU State',       desc: 'Registers, flags, and register pairs update live and highlight green on every change. Click any register pair to jump the memory view to that address. Values are editable in place.' },
  { icon: '💾', title: 'Memory',          desc: 'Browse and edit all of RAM in the hex editor. Double-click any cell to change it. RAM size is configurable (16 / 32 / 64 KB) in the menu.' },
  { icon: '🕹️', title: 'I/O & Peripherals', desc: 'Interact with the 8255 PPI, 8253 PIT, Audio Output, and 7-segment LED display. Set input ports for the IN instruction, and queue keystrokes for CALL 5 C=01H syscalls.' },
  { icon: '🔔', title: 'Interrupts',      desc: 'Fire TRAP, RST 7.5, RST 6.5, or RST 5.5 mid-program with the FIRE buttons. Control the interrupt flip-flop via EI/DI/SIM/RIM. HLT pauses and resumes on the next interrupt.' },
  { icon: '🌐', title: 'Community & Challenges', desc: 'Solve auto-verified coding challenges, or explore and share 8085 scripts via GitHub Gists.' },
  { icon: '🖩', title: 'Calculator',      desc: 'Convert values between binary, octal, decimal, and hex — handy when working out immediate operands or memory addresses.' },
  { icon: '🤖', title: 'AI Assistant',    desc: 'Enter your Anthropic API key (stored only in your browser, never sent to any server) to ask questions about 8085 assembly directly in the app.' },
]

function WelcomeModal({ onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="welcome-modal" onClick={e => e.stopPropagation()}>
        <div className="welcome-hd">
          <div className="welcome-logo">
            <div className="brand-chip" style={{fontSize:'22px',padding:'10px 14px',lineHeight:'1'}}>8085</div>
            <div>
              <div className="welcome-title">8085 Simulator</div>
              <div className="welcome-sub">Intel 8085 microprocessor simulator — running in your browser</div>
            </div>
          </div>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="welcome-grid">
          {WELCOME_FEATURES.map(f => (
            <div key={f.title} className="welcome-card">
              <span className="welcome-icon">{f.icon}</span>
              <div>
                <div className="welcome-card-title">{f.title}</div>
                <div className="welcome-card-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="welcome-footer">
          <span className="welcome-tip">
            💡 Start with Examples → I/O → LED Count to see the display in action, or Examples → Interrupts → TRAP to try the interrupt system.<br/>
            <a href="./privacy.html" target="_blank" rel="noreferrer" style={{ color: 'inherit', display: 'inline-block', marginTop: 6 }}>Privacy Policy</a>
          </span>
          <button className="btn welcome-btn" onClick={onClose}>Got it, let's go →</button>
        </div>
      </div>
    </div>
  )
}

// ── Instruction help modal ───────────────────────────────────────────────
// ── Keyboard shortcuts modal ──────────────────────────────────────────────
const SHORTCUTS = [
  { group: 'Toolbar',
    rows: [
      { keys: ['F5'],           desc: 'Assemble (Build)' },
      { keys: ['F7'],           desc: 'Step one instruction' },
      { keys: ['F8'],           desc: 'Step over call/subroutine' },
      { keys: ['F10'],          desc: 'Step out of current subroutine' },
      { keys: ['F9'],           desc: 'Run / Stop' },
      { keys: ['F6'],           desc: 'Reset (re-assemble from source)' },
    ]
  },
  { group: 'Editor',
    rows: [
      { keys: ['Ctrl', 'F'],    desc: 'Find / Replace' },
      { keys: ['Ctrl', 'Z'],    desc: 'Undo' },
      { keys: ['Ctrl', 'Y'],    desc: 'Redo' },
      { keys: ['Ctrl', 'click'],desc: 'Open instruction reference' },
      { keys: ['Right-click'],  desc: 'Run to this line (after assembly)' },
    ]
  },
  { group: 'Memory panel',
    rows: [
      { keys: ['↑ ↓ ← →'],     desc: 'Move cursor' },
      { keys: ['Enter'],        desc: 'Edit byte at cursor' },
      { keys: ['Esc'],          desc: 'Cancel edit' },
    ]
  },
  { group: 'Disassembly panel',
    rows: [
      { keys: ['Click gutter'], desc: 'Toggle breakpoint' },
      { keys: ['Right-click'],  desc: 'Set conditional breakpoint / Run to' },
    ]
  },
  { group: 'Global',
    rows: [
      { keys: ['?'],            desc: 'Show this keyboard shortcuts reference' },
      { keys: ['Esc'],          desc: 'Close any open modal' },
    ]
  },
]

function ShortcutsModal({ onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' || e.key === '?') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="help-hd">
          <span className="help-mnem">Keyboard Shortcuts</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUTS.map(g => (
            <div key={g.group} className="shortcuts-group">
              <div className="shortcuts-group-hd">{g.group}</div>
              {g.rows.map(r => (
                <div key={r.desc} className="shortcuts-row">
                  <span className="shortcuts-keys">
                    {r.keys.map((k, i) => <kbd key={i} className="shortcuts-kbd">{k}</kbd>)}
                  </span>
                  <span className="shortcuts-desc">{r.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function HelpModal({ instruction, onClose }) {
  const inst = INST_HELP[instruction]
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!inst) return null
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-hd">
          <span className="help-mnem">{instruction}</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">
          <p className="help-brief">{inst.brief}</p>
          <div className="help-meta">
            <span><span className="help-lbl">Flags</span>{inst.flags}</span>
            <span><span className="help-lbl">Size</span>{inst.bytes} byte{inst.bytes !== 1 ? 's' : ''}</span>
            <span><span className="help-lbl">Cycles</span>{inst.cycles}</span>
          </div>
          <p className="help-desc">{inst.desc}</p>
          <pre className="help-ex">{inst.ex}</pre>
        </div>
      </div>
    </div>
  )
}

// ── Inline instruction help panel ────────────────────────────────────────
function HelpPanel({ instruction }) {
  const panelRef = useRef(null)
  const inst = instruction ? INST_HELP[instruction] : null

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelRef.current.getBoundingClientRect().height
    function onMove(ev) {
      panelRef.current.style.height = Math.max(60, startH + (startY - ev.clientY)) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel help-panel" ref={panelRef}>
      <div className="help-resize-handle" onMouseDown={onResizeDown} />
      <div className="panel-hd"><span className="panel-icon">📖</span>INSTRUCTION HELP<PanelHelp panel="INSTRUCTION HELP" /></div>
      <div className="help-scroll">
        {inst ? (
          <div className="help-inline-body">
            <div className="help-inline-hd">
              <span className="help-mnem help-mnem-sm">{instruction}</span>
              <span className="help-brief">{inst.brief}</span>
            </div>
            <div className="help-meta">
              <span><span className="help-lbl">Flags</span>{inst.flags}</span>
              <span><span className="help-lbl">Size</span>{inst.bytes} byte{inst.bytes !== 1 ? 's' : ''}</span>
              <span><span className="help-lbl">Cycles</span>{inst.cycles}</span>
            </div>
            <p className="help-desc">{inst.desc}</p>
            <pre className="help-ex">{inst.ex}</pre>
          </div>
        ) : (
          <div className="help-empty">Ctrl+click an instruction for details</div>
        )}
      </div>
    </div>
  )
}

// ── Google Drive Load modal ──────────────────────────────────────────────
function DriveLoadModal({ files, loading, onClose, onSelect, onDelete }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '90vw' }}>
        <div className="help-hd">
          <span className="help-mnem">Load from "sim8085" Folder</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-body" style={{ padding: 0, maxHeight: '50vh' }}>
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>Loading files from "sim8085" folder…</div>
          ) : files.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>No files found in the "sim8085" folder.</div>
          ) : files.map(f => (
            <div key={f.id} style={{ display: 'flex', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <button className="bmenu-item" style={{ flex: 1, borderBottom: 'none' }} onClick={() => onSelect(f.id, f.name)}>
                📄 <span style={{ opacity: 0.5, marginRight: 4 }}>sim8085/</span>{f.name}
              </button>
              <button className="watch-rm" style={{ margin: '0 12px', fontSize: 13, padding: '4px 6px' }} onClick={(e) => { e.stopPropagation(); onDelete(f.id, f.name); }} title="Delete from Google Drive">🗑</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Educational Challenges View ──────────────────────────────────────────
const CHALLENGES = [
  { id: 'c1', title: '1. The Basics: Addition', desc: 'Write a program to add the byte at 0200H to the byte at 0201H and store the 8-bit result in 0202H.', setup: '    setbyte 200H, 15H\n    setbyte 201H, 20H', test: () => sim.simReadByte(0x0202) === 0x35, successMsg: '0202H correctly contains 35H!' },
  { id: 'c2', title: '2. Array Maximum', desc: 'Find the maximum value in an array of 8 bytes starting at 0200H. Store the result at 0210H.', setup: '    setbyte 200H, 34H\n    setbyte 201H, 78H\n    setbyte 202H, 12H\n    setbyte 203H, 9AH\n    setbyte 204H, 56H\n    setbyte 205H, 0BH\n    setbyte 206H, 0EFH\n    setbyte 207H, 23H', test: () => sim.simReadByte(0x0210) === 0xEF, successMsg: '0210H correctly contains EFH!' },
  { id: 'c3', title: '3. Multiplication', desc: 'Multiply the byte at 0200H by the byte at 0201H. Store the 16-bit result at 0202H.', setup: '    setbyte 200H, 0CH\n    setbyte 201H, 0AH', test: () => sim.simReadByte(0x0202) === 0x78 && sim.simReadByte(0x0203) === 0x00, successMsg: '0202H correctly contains 0078H!' },
  { id: 'c4', title: '4. String Length', desc: 'Count the length of a null-terminated ASCII string starting at 0200H. Store the byte count at 0210H.', setup: '    org 200H\n    db "Hello", 00H', test: () => sim.simReadByte(0x0210) === 0x05, successMsg: '0210H correctly contains 05H!' },
]

function ChallengesView({ onSelect }) {
  return (
    <div className="challenges-view">
      <div className="challenges-container">
        <div style={{display:'flex', alignItems:'center', gap: 12, marginBottom: 10}}>
          <span style={{fontSize: 32}}>🏆</span>
          <div>
            <h1 style={{color: 'var(--text)', fontFamily:'var(--mono)', fontSize: 24, letterSpacing: 1}}>EDUCATIONAL CHALLENGES</h1>
            <p style={{color: 'var(--text2)', fontSize: 14}}>Select a challenge to load its initial state into the simulator. Run your code to automatically verify the result!</p>
          </div>
        </div>
        <div className="challenge-grid">
          {CHALLENGES.map(c => (
            <div key={c.id} className="challenge-card" onClick={() => onSelect(c)}>
              <div className="challenge-title">{c.title}</div>
              <div className="challenge-desc">{c.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Community Gallery View ───────────────────────────────────────────────
function CommunityView({ onSelect, githubToken }) {
  const [username, setUsername] = useState('selfmodify')
  const [scripts, setScripts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function fetchScripts(user) {
    if (!user) return
    setLoading(true)
    setError(null)
    setScripts([])
    try {
      const headers = githubToken ? { 'Authorization': `token ${githubToken}` } : {}
      const res = await fetch(`https://api.github.com/users/${user}/gists`, { headers })
      if (!res.ok) throw new Error('User not found or GitHub API limit reached')
      const data = await res.json()
      const valid = []
      for (const g of data) {
        const files = Object.values(g.files)
        const asmFile = files.find(f => f.filename.toLowerCase().endsWith('.asm') || f.filename.toLowerCase().endsWith('.85'))
        if (asmFile) {
          valid.push({ id: g.id, title: g.description || asmFile.filename, author: g.owner?.login || user, desc: asmFile.filename })
        }
      }
      setScripts(valid)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchScripts(username) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="challenges-view">
      <div className="challenges-container">
        <div style={{display:'flex', alignItems:'center', gap: 12, marginBottom: 10}}>
          <span style={{fontSize: 32}}>🌐</span>
          <div style={{flex: 1}}>
            <h1 style={{color: 'var(--text)', fontFamily:'var(--mono)', fontSize: 24, letterSpacing: 1}}>COMMUNITY GALLERY</h1>
            <p style={{color: 'var(--text2)', fontSize: 14}}>Explore and run 8085 assembly scripts shared via public GitHub Gists.</p>
          </div>
          <div style={{display:'flex', gap: 6}}>
            <input className="chat-input" placeholder="GitHub username" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchScripts(username)} style={{width: 160}} />
            <button className="btn" onClick={() => fetchScripts(username)} disabled={loading}>Fetch</button>
          </div>
        </div>
        <div style={{ background: 'var(--bg2)', padding: '14px 18px', borderRadius: 'var(--radius-md)', marginBottom: '20px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8, fontFamily: 'var(--mono)', fontWeight: 700 }}>WHAT IS A GITHUB GIST?</div>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 8 }}>
            A <strong>Gist</strong> is a quick way to share code snippets on GitHub. This Community tab lets you easily discover and run 8085 assembly programs shared by other developers!
          </p>
          <ul style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, paddingLeft: 20 }}>
            <li style={{ marginBottom: 4 }}><strong>To share your code:</strong> Click <em>Export ⇣ → 🐙 Save to GitHub Gist</em>. Your code will instantly become a public Gist.</li>
            <li><strong>To find code:</strong> Type any GitHub username in the search box above to fetch all their shared <code>.asm</code> or <code>.85</code> files.</li>
          </ul>
        </div>
        {loading && <div style={{color: 'var(--text3)', textAlign: 'center', padding: 40}}>Fetching Gists from GitHub...</div>}
        {error && <div style={{color: 'var(--red)', textAlign: 'center', padding: 40}}>✗ {error}</div>}
        {!loading && !error && scripts.length === 0 && <div style={{color: 'var(--text3)', textAlign: 'center', padding: 40}}>No .asm or .85 Gists found for this user.</div>}
        <div className="challenge-grid">
          {scripts.map(g => (
            <div key={g.id} className="challenge-card" onClick={() => onSelect(g.id)}>
              <div className="challenge-title">{g.title}</div>
              <div style={{fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: -4}}>by @{g.author}</div>
              <div className="challenge-desc">{g.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── GitHub Token Setup Modal ─────────────────────────────────────────────
function GithubSetupModal({ onClose, onSave }) {
  const [token, setToken] = useState(() => localStorage.getItem('sim8085_github_token') || '')
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="welcome-modal" style={{ width: 440, maxWidth: '90vw', padding: '20px 24px', display: 'block', height: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="help-hd" style={{ marginBottom: 16, background: 'transparent', border: 'none', padding: 0 }}>
          <span className="help-mnem" style={{ fontSize: 16 }}>GitHub Integration</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 16 }}>
          To save scripts and bypass GitHub's API rate limits, provide a Personal Access Token with the <b>gist</b> scope.
        </p>
        <input className="chat-input" type="password" placeholder="ghp_..." value={token} onChange={e => setToken(e.target.value)} style={{ width: '100%', marginBottom: 16 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a href="https://github.com/settings/tokens/new?scopes=gist&description=sim8085+Simulator" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 12, textDecoration: 'none' }}>Create a token →</a>
          <div>
            {localStorage.getItem('sim8085_github_token') && <button className="btn" style={{ marginRight: 8 }} onClick={() => { localStorage.removeItem('sim8085_github_token'); onSave?.(); onClose(); }}>Clear Token</button>}
            <button className="btn btn-run" onClick={() => { if(token.trim()) localStorage.setItem('sim8085_github_token', token.trim()); onSave?.(); onClose(); }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Global UI Dialog ──────────────────────────────────────────────────────
function UIDialog({ dialog, onClose }) {
  const [input, setInput] = useState(dialog.defaultValue || '')
  const inputRef = useRef(null)
  useEffect(() => {
    if (dialog.type === 'prompt' && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [dialog])

  function handleConfirm() {
    if (dialog.onConfirm) dialog.onConfirm(dialog.type === 'prompt' ? input : undefined)
    onClose()
  }

  function handleCancel() {
    if (dialog.onCancel) dialog.onCancel()
    onClose()
  }

  return (
    <div className="help-overlay" onClick={handleCancel} style={{ zIndex: 9999 }}>
      <div className="welcome-modal" style={{ width: 440, maxWidth: '90vw', height: 'auto', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="help-hd" style={{ padding: '12px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
          <span className="help-mnem" style={{ fontSize: 16 }}>{dialog.title || 'Message'}</span>
          <button className="help-close" onClick={handleCancel}>✕</button>
        </div>
        <div style={{ padding: '20px 16px' }}>
          <p style={{ color: 'var(--text2)', fontSize: 14, whiteSpace: 'pre-wrap', marginBottom: dialog.type === 'prompt' ? 16 : 0, fontFamily: 'var(--sans)' }}>{dialog.message}</p>
          {dialog.type === 'prompt' && <input ref={inputRef} className="chat-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleConfirm()} style={{ width: '100%', fontSize: 14, padding: '6px 8px' }} />}
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {dialog.type !== 'alert' && <button className="btn" onClick={handleCancel}>{dialog.cancelText || 'Cancel'}</button>}
          <button className="btn btn-run" onClick={handleConfirm}>{dialog.confirmText || 'OK'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Root app ─────────────────────────────────────────────────────────────
export default function App() {
  const [src, setSrc]           = useState(() => {
    try {
      const hash = location.hash
      if (hash.startsWith('#code=')) { const d = b64decode(hash.slice(6)); if (d) return d }
      if (hash.startsWith('#example=')) {
        const exName = decodeURIComponent(hash.slice(9)).replace(/_/g, ' ')
        for (const cat in EXAMPLES) {
          if (EXAMPLES[cat][exName]) return EXAMPLES[cat][exName]
        }
      }
      const saved = localStorage.getItem('sim8085_program')
      if (saved) return saved
    } catch {}
    return EXAMPLES['I/O']['LED Count']
  })
  const [fileName, setFileName]  = useState(() => {
    try {
      const hash = location.hash
      if (hash.startsWith('#example=')) {
        const exName = decodeURIComponent(hash.slice(9)).replace(/_/g, ' ')
        for (const cat in EXAMPLES) { if (EXAMPLES[cat][exName]) return exName }
      }
    } catch {}
    return localStorage.getItem('sim8085_filename') || ''
  })
  const [regs, setRegs]         = useState({a:0,b:0,c:0,d:0,e:0,h:0,l:0,flags:0,pc:0x100,sp:0,flagS:0,flagZ:0,flagAC:0,flagP:0,flagCY:0,halted:false,hasError:false})
  const [prevRegs, setPrev]     = useState(null)
  const [leds, setLeds]         = useState(Array(8).fill(0))
  const [bps, setBps]           = useState(() => {
    try { return new Map(JSON.parse(localStorage.getItem('sim8085_bps')) || []) } catch { return new Map() }
  })
  const [dataBps, setDataBps]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('sim8085_databps')) || []) } catch { return new Set() }
  })
  const [callStack, setCallStack] = useState([])          // [{callAddr, retAddr, targetAddr}]
  const callStackRef = useRef([])
  const [hitcnts, setHitcnts]   = useState(null)          // Map<addr, count> or null
  const [maxHit, setMaxHit]     = useState(0)
  const [trace, setTrace]       = useState([])
  const [changedAddrs, setChangedAddrs] = useState(new Set())
  const [watches, setWatches]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('sim8085_watches')) || [] } catch { return [] }
  })
  const [outputPorts, setOutputPorts] = useState([])      // [{port,val}] written by OUT
  const [inputPresets, setInputPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sim8085_io_presets')) || [] } catch { return [] }
  })
  const [keyQueue, setKeyQueue]   = useState([])          // chars queued for C=01H syscall
  const [intState, setIntState] = useState(() => sim.simGetIntState())
  const [sid, setSid] = useState(0)
  const [sod, setSod] = useState(0)
  const [memStart, setMemStart] = useState(0x100)
  const [appState, setAppState] = useState('idle')  // idle | running | halted | error
  const [engineMode, setEngineMode]   = useState('js')    // 'js' | 'wasm'
  const [engineSwitching, setEngineSwitching] = useState(false)
  const [msg, setMsg]           = useState('Load an example or write code, then click Build.')
  const [steps, setSteps]       = useState(0)
  const [mhz,   setMhz]         = useState(0)
  const [cycles, setCycles]     = useState(0)
  const [pcFlash, setPcFlash]   = useState(0)
  const [buildId, setBuildId]   = useState(0)
  const [symbols, setSymbols]   = useState({})
  const [programRegion, setProgramRegion] = useState(null)
  const [presetAddrs, setPresetAddrs]     = useState(new Set())
  const [cursorInst, setCursorInst] = useState(null)
  const [helpInst, setHelpInst]     = useState(null)
  const [errorLine, setErrorLine]   = useState(null)
  const [consoleOutput, setConsoleOutput] = useState('')
  const [consolePort,   setConsolePort]   = useState(() => sim.simGetConsolePort())
  const [mobileTab,      setMobileTab]      = useState('editor')
  const [activeView,     setActiveView]     = useState('simulator') // 'simulator' | 'challenges'
  const [theme, setTheme] = useState(() => localStorage.getItem('sim8085_theme') || 'green')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('sim8085_theme', theme)
  }, [theme])
  const [crtBrightness, setCrtBrightness] = useState(() => parseFloat(localStorage.getItem(`sim8085_crt_b_${localStorage.getItem('sim8085_theme') || 'green'}`) || '1'))
  const [crtContrast, setCrtContrast]     = useState(() => parseFloat(localStorage.getItem(`sim8085_crt_c_${localStorage.getItem('sim8085_theme') || 'green'}`) || '1'))
  const [crtGlitch, setCrtGlitch]         = useState(() => { const v = localStorage.getItem('sim8085_crt_glitch'); return v === 'true' ? 'flicker' : (v && v !== 'false' ? v : 'off') })
  const [chaosCalm, setChaosCalm]         = useState(false)
  useEffect(() => {
    setCrtBrightness(parseFloat(localStorage.getItem(`sim8085_crt_b_${theme}`) || '1'))
    setCrtContrast(parseFloat(localStorage.getItem(`sim8085_crt_c_${theme}`) || '1'))
  }, [theme])
  function toggleTheme() {
    setTheme(t =>
      t === 'dark'       ? 'dim'        :
      t === 'dim'        ? 'light'      :
      t === 'light'      ? 'amber-mono' :
      t === 'amber-mono' ? 'gray-crt'   :
      t === 'gray-crt'   ? 'green'      : 'dark'
    )
  }

  const [driveFiles, setDriveFiles] = useState(null)
  const [driveToken, setDriveToken] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sim8085_drive_token'))
      if (saved && saved.token && saved.expiresAt > Date.now()) return saved.token
    } catch {}
    return null
  })
  const [driveMenuOpen, setDriveMenuOpen] = useState(false)
  const driveMenuRef = useRef(null)
  
  useEffect(() => {
    if (!driveMenuOpen) return
    const handler = e => { if (!driveMenuRef.current?.contains(e.target)) setDriveMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [driveMenuOpen])

  useEffect(() => {
    if (!driveToken) localStorage.removeItem('sim8085_drive_token')
  }, [driveToken])
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveSaveStatus, setDriveSaveStatus] = useState(null)
  const [activeChallenge, setActiveChallenge] = useState(null)
  const [challengeResult, setChallengeResult] = useState(null)
  const [appDialog, setAppDialog]             = useState(null)
  const [showGithubSetup, setShowGithubSetup] = useState(false)
  const [haltTrigger, setHaltTrigger]         = useState(0)
  const lastHaltRef                           = useRef(0)
  
  const [panels, setPanels] = useState(() => {
    const def = { regs:true, pairs:true, flags:true, ints:true, io:true, memmap:false, ppi:true, pit:false, audio:true, stack:true, callstack:true, trace:true }
    try { return { ...def, ...JSON.parse(localStorage.getItem('sim8085_panels')) } } catch { return def }
  })
  function togglePanel(key) {
    setPanels(p => {
      const next = { ...p, [key]: !p[key] }; localStorage.setItem('sim8085_panels', JSON.stringify(next)); return next
    })
  }

  const [showWelcome,    setShowWelcome]    = useState(() => !localStorage.getItem('sim8085_welcomed'))
  const [showCalc,       setShowCalc]       = useState(false)
  const [showChat,       setShowChat]       = useState(false)
  const [showShortcuts,  setShowShortcuts]  = useState(false)
  function dismissWelcome() { localStorage.setItem('sim8085_welcomed', '1'); setShowWelcome(false) }
  const [runSpeed, setRunSpeed]     = useState(() => {
    const s = parseInt(localStorage.getItem('sim8085_speed'), 10)
    return s >= 0 && s < SPEEDS.length ? s : 3
  })
  const MEM_SIZES = [16*1024, 32*1024, 64*1024]
  const [memSize, _setMemSize] = useState(() => {
    const s = parseInt(localStorage.getItem('sim8085_memsize'), 10)
    return MEM_SIZES.includes(s) ? s : 64*1024
  })
  const memSizeRef = useRef(memSize)
  const [regBase, setRegBase]       = useState('hex')    // 'hex'|'dec'|'bin'
  const [statusLog, setStatusLog]   = useState([])
  const [histLen, setHistLen]       = useState(0)        // for disabling Step Back button
  const timerRef            = useRef(null)
  const warpActiveRef       = useRef(false)
  const warpWorkerRef       = useRef(null)
  const workerReadyPromise  = useRef(null)
  const warpWorkerActiveRef = useRef(false)
  const lastUiRef           = useRef(0)
  const wasHaltWaitingRef = useRef(false)
  const throughputRef = useRef({ steps: 0, ms: 0, mhz: 0 })
  const editorColRef = useRef(null)
  const rightColRef  = useRef(null)
  const gotoLineRef  = useRef(null)
  const lineAddrRef  = useRef(new Map())  // lineNumber → address (reverse of addrLineMap)
  const fileInputRef   = useRef(null)
  const oneShotBpsRef  = useRef(new Set())
  const memWatchMemRef = useRef(null)
  const memWatchWatchRef = useRef(null)
  const disasmStackRef = useRef(null)
  const [addrLineMap, setAddrLineMap] = useState(new Map())
  const srcRef      = useRef(src)
  const lastBuiltSrcRef = useRef(src)
  const speedRef    = useRef((() => { const s = parseInt(localStorage.getItem('sim8085_speed'),10); return s>=0&&s<SPEEDS.length?s:3 })())
  const historyRef  = useRef([])
  const bpsRef      = useRef(new Map())
  const prevMemRef  = useRef(null)

  useEffect(() => { bpsRef.current = bps }, [bps])

  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem('sim8085_program', src) } catch {} }, 1000)
    return () => clearTimeout(t)
  }, [src])

  function onEditorResizeDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = editorColRef.current.getBoundingClientRect().width
    function onMove(ev) {
      editorColRef.current.style.flexBasis = Math.max(180, Math.min(640, startW + (ev.clientX - startX))) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function onRightResizeDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = rightColRef.current.getBoundingClientRect().width
    function onMove(ev) {
      rightColRef.current.style.flexBasis = Math.max(160, Math.min(600, startW - (ev.clientX - startX))) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function onMemWatchDividerDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = memWatchMemRef.current.getBoundingClientRect().width
    function onMove(ev) {
      memWatchMemRef.current.style.flex = `0 0 ${Math.max(80, startW + (ev.clientX - startX))}px`
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function onDisasmStackDividerDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = disasmStackRef.current.getBoundingClientRect().width
    function onMove(ev) {
      disasmStackRef.current.style.flex = `0 0 ${Math.max(100, startW - (ev.clientX - startX))}px`
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    sim.simInit()
    const hash = window.location.hash
    if (hash.startsWith('#gist=')) {
      loadFromGist(hash.slice(6))
      window.history.replaceState(null, '', window.location.pathname)
    } else {
      doAssemble(src)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hotkeysRef = useRef(null)
  useEffect(() => { hotkeysRef.current = { doAssemble, handleReset, doStep, doStepOver, doStepOut, handleRun, running, appState } })
  useEffect(() => {
    function onKey(e) {
      const h = hotkeysRef.current
      if (e.key === 'F5') { e.preventDefault(); h.doAssemble(srcRef.current) }
      if (e.key === 'F6') { e.preventDefault(); h.handleReset() }
      if (e.key === 'F7') { e.preventDefault(); if (!h.running && h.appState !== 'error') h.doStep() }
      if (e.key === 'F8') { e.preventDefault(); if (!h.running && h.appState !== 'error') h.doStepOver() }
      if (e.key === 'F10') { e.preventDefault(); if (!h.running && h.appState !== 'error') h.doStepOut() }
      if (e.key === 'F9') { e.preventDefault(); if (h.appState !== 'error' || h.running) h.handleRun() }
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); setShowShortcuts(s => !s)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (msg === 'Load an example or write code, then click Build.') return
    const t = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})
    const kind = msg.startsWith('✗') || msg.startsWith('❌') ? 'error' : msg.startsWith('✓') || msg.startsWith('🏆') ? 'success' : msg.startsWith('■') ? 'halted' : 'info'
    setStatusLog(log => [...log.slice(-19), { text: msg, kind, t }])
  }, [msg])

  useEffect(() => {
    if (haltTrigger > lastHaltRef.current && activeChallenge && !challengeResult) {
      lastHaltRef.current = haltTrigger
      if (activeChallenge.test()) {
        setChallengeResult({ passed: true, msg: activeChallenge.successMsg })
        setMsg(`🏆 Challenge Passed: ${activeChallenge.successMsg}`)
      } else {
        setChallengeResult({ passed: false, msg: 'Memory output does not match expected result. Check your logic and try again!' })
        setMsg(`❌ Challenge Failed: Output is incorrect. Keep trying!`)
      }
    }
  }, [haltTrigger, activeChallenge, challengeResult])

  function refresh() {
    const r = sim.simGetRegisters()
    setRegs(old => { setPrev(old); return r })
    setLeds(sim.simGetAllLeds())
    setCycles(sim.simGetCycles())
    setIntState(sim.simGetIntState())
    setKeyQueue(sim.simGetKeyQueue())
    setConsoleOutput(sim.simGetConsoleOutput())
    if (sim.simGetSOD) setSod(sim.simGetSOD())
    refreshProfile()
  }

  function refreshProfile() {
    if (!sim.simGetHitcntRange) return
    const pr = sim.simGetProgramRegion()
    const start = pr?.start ?? 0x100
    const end   = Math.min((pr?.end ?? 0x200) + 16, 0xFFFF)
    const len   = end - start + 1
    if (len <= 0) return
    const counts = sim.simGetHitcntRange(start, len)
    let mx = 0; const m = new Map()
    for (let i = 0; i < len; i++) {
      if (counts[i] > 0) { m.set(start + i, counts[i]); if (counts[i] > mx) mx = counts[i] }
    }
    setHitcnts(m.size > 0 ? m : null)
    setMaxHit(mx)
  }

  function changeConsolePort(n) {
    sim.simSetConsolePort(n)
    setConsolePort(n)
  }

  function refreshOutputPorts() {
    setOutputPorts(sim.simGetOutputPorts())
  }

  useEffect(() => { try { localStorage.setItem('sim8085_bps', JSON.stringify([...bps.entries()])) } catch {} }, [bps])
  useEffect(() => { try { localStorage.setItem('sim8085_databps', JSON.stringify([...dataBps])) } catch {} }, [dataBps])
  useEffect(() => { try { localStorage.setItem('sim8085_watches', JSON.stringify(watches)) } catch {} }, [watches])
  useEffect(() => { try { localStorage.setItem('sim8085_io_presets', JSON.stringify(inputPresets)) } catch {} }, [inputPresets])

  function doAssemble(code) {
    try {
      stopRun()
      historyRef.current = []
      setHistLen(0)
      setTrace([])
      setCallStack([]); callStackRef.current = []
    setChallengeResult(null)
      setHitcnts(null); setMaxHit(0)
      setChangedAddrs(new Set())
      setOutputPorts([])
      setKeyQueue([])
      setConsoleOutput('')
      prevMemRef.current = null
      sim.simSetMemorySize(memSizeRef.current)
      sim.simInit()
      for (const addr of dataBps) sim.simSetDataBreakpoint(addr)
      for (const addr of bpsRef.current.keys()) sim.simSetBreakpoint(addr)
      for (const p of inputPresets) sim.simSetInputPort(p.port, p.val)
      throughputRef.current = { steps: 0, ms: 0, mhz: 0 }
      const res = sim.simAssemble(code)
      setBuildId(id => id + 1)
      setSteps(0); setMhz(0); throughputRef.current = { steps: 0, ms: 0, mhz: 0 }
      refresh()
      if (!res.ok) {
        const m = res.errorMsg?.match(/^Line (\d+)/)
        setErrorLine(m ? parseInt(m[1]) : null)
        setAddrLineMap(new Map())
        lineAddrRef.current = new Map()
        setSymbols({})
        setProgramRegion(null)
        setPresetAddrs(new Set())
        setAppState('error')
        setMsg(`✗ ${res.errorMsg}`)
      } else {
        setErrorLine(null)
        setAppState('idle')
        const alm = buildAddrLineMap(code)
        setAddrLineMap(alm)
        const rev = new Map(); for (const [addr, ln] of alm) rev.set(ln, addr)
        lineAddrRef.current = rev
        setSymbols(sim.simGetSymbols())
        setProgramRegion(sim.simGetProgramRegion())
        setPresetAddrs(sim.simGetPresetAddrs())
        setMsg(`✓ Build completed (${res.bytesEmitted}B at ${hex4(res.entryPoint)}H)`)
        lastBuiltSrcRef.current = code
      }
    } catch (err) {
      setAppState('error')
      setMsg(`✗ Internal error: ${err.message}`)
    }
  }

  function pushHistory() {
    const snap = { regs: sim.simGetRegisters(), ram: sim.simGetFullMemory(), cycles: sim.simGetCycles() }
    const next = [...historyRef.current.slice(-19), snap]
    historyRef.current = next
    setHistLen(next.length)
  }

  const CALL_OPS = new Set([0xCD,0xC4,0xCC,0xD4,0xDC,0xE4,0xEC,0xF4,0xFC])
  const RET_OPS  = new Set([0xC9,0xC0,0xC8,0xD0,0xD8,0xE0,0xE8,0xF0,0xF8])
  const RST_OPS  = new Set([0xC7,0xCF,0xD7,0xDF,0xE7,0xEF,0xF7,0xFF])

  function performStep() {
    const prevR = sim.simGetRegisters()
    const op = sim.simReadByte(prevR.pc)
    const ok = sim.simStep()
    const afterR = sim.simGetRegisters()

    if (CALL_OPS.has(op) || RST_OPS.has(op)) {
      const targetAddr = afterR.pc
      const retAddr = prevR.pc + (RST_OPS.has(op) ? 1 : 3)
      const next = [...callStackRef.current, { callAddr: prevR.pc, retAddr, targetAddr }]
      callStackRef.current = next
      setCallStack(next)
    } else if (RET_OPS.has(op) && callStackRef.current.length > 0) {
      const next = callStackRef.current.slice(0, -1)
      callStackRef.current = next
      setCallStack(next)
    }

    addTraceEntry(prevR)
    return { ok, prevR, afterR, op }
  }

  function doStep() {
    stopRun()
    pushHistory()
    const { ok } = performStep()
    setSteps(s => s + 1)
    setPcFlash(f => f + 1)
    refresh()
    updateMemDiff()
    refreshOutputPorts()
    if (sim.simIsHaltWaiting()) {
      setAppState('halted')
      setMsg('⏸ HLT — awaiting interrupt…')
      setHaltTrigger(t => t + 1)
    } else if (!sim.simIsRunning()) {
      setAppState(sim.simGetError() ? 'error' : 'halted')
      setMsg(sim.simGetError() ? `✗ ${sim.simGetError()}` : '■ Program halted.')
      if (!sim.simGetError()) setHaltTrigger(t => t + 1)
    } else if (!ok) {
      setAppState('idle')  // interrupt fired from HLT wait, ISR starting
    }
  }

  function doStepOver() {
    if (running || appState === 'error') return
    stopRun()
    const currentR = sim.simGetRegisters()
    const op = sim.simReadByte(currentR.pc)
    if (!CALL_OPS.has(op) && !RST_OPS.has(op)) {
      return doStep()
    }
    pushHistory()
    const retAddr = currentR.pc + (RST_OPS.has(op) ? 1 : 3)
    let stepCount = 0
    let result = null
    while (true) {
      result = performStep()
      stepCount += 1
      if (!result.ok) break
      if (result.afterR.pc === retAddr) break
      if (sim.simIsHaltWaiting() || !sim.simIsRunning() || sim.simGetError()) break
    }

    setSteps(s => s + stepCount)
    setPcFlash(f => f + 1)
    refresh()
    updateMemDiff()
    refreshOutputPorts()
    if (sim.simIsHaltWaiting()) {
      setAppState('halted')
      setMsg('⏸ HLT — awaiting interrupt…')
      setHaltTrigger(t => t + 1)
    } else if (!sim.simIsRunning()) {
      setAppState(sim.simGetError() ? 'error' : 'halted')
      setMsg(sim.simGetError() ? `✗ ${sim.simGetError()}` : '■ Program halted.')
      if (!sim.simGetError()) setHaltTrigger(t => t + 1)
    } else if (result && !result.ok) {
      setAppState('idle')
    }
  }

  function doStepOut() {
    if (running || appState === 'error') return
    if (callStackRef.current.length === 0) return doStep()
    stopRun()
    pushHistory()

    const targetDepth = callStackRef.current.length - 1
    let stepCount = 0
    let result = null
    while (true) {
      result = performStep()
      stepCount += 1
      if (!result.ok) break
      if (callStackRef.current.length === targetDepth) break
      if (sim.simIsHaltWaiting() || !sim.simIsRunning() || sim.simGetError()) break
    }

    setSteps(s => s + stepCount)
    setPcFlash(f => f + 1)
    refresh()
    updateMemDiff()
    refreshOutputPorts()
    if (sim.simIsHaltWaiting()) {
      setAppState('halted')
      setMsg('⏸ HLT — awaiting interrupt…')
      setHaltTrigger(t => t + 1)
    } else if (!sim.simIsRunning()) {
      setAppState(sim.simGetError() ? 'error' : 'halted')
      setMsg(sim.simGetError() ? `✗ ${sim.simGetError()}` : '■ Program halted.')
      if (!sim.simGetError()) setHaltTrigger(t => t + 1)
    } else if (result && !result.ok) {
      setAppState('idle')
    }
  }

  function doStepBack() {
    if (!historyRef.current.length) return
    const snap = historyRef.current[historyRef.current.length - 1]
    const next = historyRef.current.slice(0, -1)
    historyRef.current = next
    setHistLen(next.length)
    sim.simRestoreSnapshot(snap)
    if (snap.cycles !== undefined) sim.simSetCycles(snap.cycles)
    setSteps(s => Math.max(0, s - 1))
    setPcFlash(f => f+1)
    setAppState('idle')
    setMsg(`⟲ Stepped back — ${next.length} step${next.length !== 1 ? 's' : ''} remaining in history`)
    refresh()
  }

  function ensureWarpWorker() {
    if (workerReadyPromise.current) return workerReadyPromise.current
    const worker = new Worker(import.meta.env.BASE_URL + 'sim.worker.js')
    warpWorkerRef.current = worker
    workerReadyPromise.current = new Promise((resolve, reject) => {
      const onReady = ({ data }) => {
        if (data.type === 'ready') { worker.removeEventListener('message', onReady); resolve() }
        if (data.type === 'error') { worker.removeEventListener('message', onReady); reject(new Error(data.error)) }
      }
      worker.addEventListener('message', onReady)
    })
    worker.postMessage({ cmd: 'init', baseUrl: import.meta.env.BASE_URL })
    return workerReadyPromise.current
  }

  function startRun() {
    if (timerRef.current) return
    setAppState('running')

    function finalizeTick(atBp, over = {}) {
      const r = sim.simGetRegisters()
      const watchHit = over.watchHit !== undefined ? over.watchHit : (sim.simGetDataWatchHit ? sim.simGetDataWatchHit() : -1)
      if (oneShotBpsRef.current.size > 0) {
        const next = new Map(bpsRef.current)
        for (const addr of oneShotBpsRef.current) next.delete(addr)
        oneShotBpsRef.current.clear()
        syncBps(next)
      }
      updateMemDiff()
      stopRun()
      setPcFlash(f => f + 1)
      if (watchHit >= 0) {
        setAppState('idle')
        setMsg(`⏹ Watchpoint: write to ${hex4(watchHit)}H at PC=${hex4(r.pc)}H`)
      } else if (atBp) {
        setAppState('idle')
        setMsg(`⏹ Breakpoint at ${hex4(r.pc)}H`)
      } else {
        const isHalted = over.isHalted !== undefined ? over.isHalted : sim.simIsHalted()
        const errMsg   = over.errorMsg  !== undefined ? over.errorMsg  : sim.simGetError()
        setAppState(isHalted ? 'halted' : 'error')
        setMsg(isHalted ? '■ Program halted.' : `✗ ${errMsg}`)
        if (isHalted) setHaltTrigger(t => t + 1)
      }
    }

    if (SPEEDS[speedRef.current].warp) {
      setMsg('⚡ Warp…')
      warpActiveRef.current = true
      lastUiRef.current = 0
      wasHaltWaitingRef.current = false
      throughputRef.current = { steps: 0, ms: 0, mhz: 0, pendingSteps: 0, _last: performance.now() }

      if (getEngineMode() === 'wasm') {
        ensureWarpWorker().then(() => {
          if (!warpActiveRef.current) return  // stopped before worker was ready
          const ram = sim.simGetFullMemory()
          const snap = {
            regs:        sim.simGetRegisters(),
            ram,
            memSize:     memSizeRef.current,
            breakpoints: [...bpsRef.current.entries()],
            dataBps:     [...dataBps],
            inputPorts:  sim.simGetAllInputPorts(),
            consolePort: sim.simGetConsolePort(),
            keyQueue:    sim.simGetKeyQueue(),
          }
          warpWorkerActiveRef.current = true
          warpWorkerRef.current.onmessage = ({ data: d }) => {
            if (!warpWorkerActiveRef.current && d.type !== 'stopped') return
            if (d.type === 'stateUpdate') {
              if (d.pendingSteps > 0) setSteps(s => s + d.pendingSteps)
              setMhz(d.mhz || 0)
              setRegs(old => { setPrev(old); return d.regs })
              setLeds(d.leds)
              setCycles(d.cycles)
              setIntState(d.intState)
              setKeyQueue(d.keyQueue)
              setConsoleOutput(d.consoleOutput)
              setSod(d.sod)
              setOutputPorts(d.outputPorts)
            } else if (d.type === 'haltWaiting') {
              setMsg('⏸ HLT — awaiting interrupt…')
            } else if (d.type === 'stopped') {
              warpWorkerActiveRef.current = false
              sim.simRestoreSnapshot({ regs: d.regs, ram: d.ram })
              if (d.reason === 'stopped') {
                refresh(); refreshOutputPorts()
              } else {
                finalizeTick(d.atBp, { watchHit: d.watchHit, isHalted: d.isHalted, errorMsg: d.errorMsg })
              }
              // Override any stale WASM reads with accurate worker-measured values
              setCycles(d.cycles)
              setLeds(d.leds)
              setConsoleOutput(d.consoleOutput)
              setIntState(d.intState)
              setSod(d.sod)
              setOutputPorts(d.outputPorts)
              setKeyQueue(d.keyQueue)
            }
          }
          warpWorkerRef.current.postMessage({ cmd: 'startWarp', snap }, [ram.buffer])
        })
        return
      }

      const channel = new MessageChannel()

      const tick = () => {
        if (!warpActiveRef.current) return
        
        let n = 0
        const startTick = performance.now()
        while (performance.now() - startTick < 100) {
          const chunk = sim.simRun(2000000)
          n += chunk
          if (chunk < 2000000) break
        }
        const execMs = performance.now() - startTick

        const tp = throughputRef.current
        tp.steps += n
        tp.ms += execMs
        tp.pendingSteps = (tp.pendingSteps || 0) + n
        if (tp.ms >= 250) { tp.mhz = tp.steps / tp.ms / 1000; tp.steps = 0; tp.ms = 0; }

        const now = Date.now()
        const isHaltWaiting = sim.simIsHaltWaiting()
        const doUi = (now - lastUiRef.current >= 1000) || (isHaltWaiting && !wasHaltWaitingRef.current)
        if (doUi) {
          if (tp.pendingSteps > 0) { setSteps(s => s + tp.pendingSteps); tp.pendingSteps = 0 }
          setMhz(tp.mhz || 0)
          refresh()
          refreshOutputPorts()
          lastUiRef.current = now
        }
        const justHalted = isHaltWaiting && !wasHaltWaitingRef.current
        wasHaltWaitingRef.current = isHaltWaiting
        if (justHalted) setHaltTrigger(t => t + 1)

        if (isHaltWaiting) {
          setMsg('⏸ HLT — awaiting interrupt…')
          timerRef.current = setTimeout(tick, 16)
          return
        }
        const r = sim.simGetRegisters()
        const atBp = bpsRef.current.has(r.pc)
        const watchHit = sim.simGetDataWatchHit ? sim.simGetDataWatchHit() : -1
        if (!sim.simIsRunning() || atBp || watchHit >= 0) {
          const cond = bpsRef.current.get(r.pc)
          if (atBp && watchHit < 0 && cond != null && !evalCondition(cond, r)) {
            sim.simStep()
            timerRef.current = -1
            channel.port2.postMessage(null)
            return
          }
          if (tp.pendingSteps > 0) { setSteps(s => s + tp.pendingSteps); tp.pendingSteps = 0 }
          refresh(); refreshOutputPorts()
          warpActiveRef.current = false; timerRef.current = null
          finalizeTick(atBp)
          return
        }
        if (doUi) {
          timerRef.current = setTimeout(tick, 16)
        } else {
          timerRef.current = -1
          channel.port2.postMessage(null)
        }
      }
      
      channel.port1.onmessage = tick
      timerRef.current = -1
      channel.port2.postMessage(null)
      return
    }

    setMsg('▶ Running…')
    lastUiRef.current = 0
    wasHaltWaitingRef.current = false
    throughputRef.current = { steps: 0, ms: 0, mhz: 0, pendingSteps: 0, _last: performance.now() }
    timerRef.current = setInterval(() => {
      const n = sim.simRun(SPEEDS[speedRef.current].steps)
      const tp = throughputRef.current
      const perfNow = performance.now()
      tp.steps += n; tp.ms += (perfNow - (tp._last ?? perfNow)); tp._last = perfNow; tp.pendingSteps = (tp.pendingSteps || 0) + n
      if (tp.ms >= 100) { tp.mhz = tp.steps / tp.ms / 1000; tp.steps = 0; tp.ms = 0; }
      const isFast = SPEEDS[speedRef.current].steps >= 1000
      const now = Date.now()
      const isHaltWaiting = sim.simIsHaltWaiting()
      const doUi = !isFast || (now - lastUiRef.current >= 250) || (isHaltWaiting && !wasHaltWaitingRef.current)
      if (doUi) {
        if (tp.pendingSteps > 0) { setSteps(s => s + tp.pendingSteps); tp.pendingSteps = 0 }
        setMhz(tp.mhz || 0)
        refresh()
        refreshOutputPorts()
        if (!isFast) updateMemDiff()
        lastUiRef.current = now
      }
      const justHalted = isHaltWaiting && !wasHaltWaitingRef.current
      wasHaltWaitingRef.current = isHaltWaiting
      if (justHalted) setHaltTrigger(t => t + 1)

      if (isHaltWaiting) {
        setMsg('⏸ HLT — awaiting interrupt…')
        return
      }
      const watchHit2 = sim.simGetDataWatchHit ? sim.simGetDataWatchHit() : -1
      const r = sim.simGetRegisters()
      const atBp = bpsRef.current.has(r.pc)
      if (!sim.simIsRunning() || atBp || watchHit2 >= 0) {
        const cond = bpsRef.current.get(r.pc)
        if (atBp && watchHit2 < 0 && cond != null && !evalCondition(cond, r)) {
          sim.simStep(); return
        }
        if (tp.pendingSteps > 0) { setSteps(s => s + tp.pendingSteps); tp.pendingSteps = 0 }
        refresh(); refreshOutputPorts()
        finalizeTick(atBp)
      }
    }, SPEEDS[speedRef.current].delay || 16)
  }

  function stopRun() {
    warpActiveRef.current = false
    if (warpWorkerActiveRef.current) {
      warpWorkerRef.current?.postMessage({ cmd: 'stop' })
      wasHaltWaitingRef.current = false
      if (appState === 'running') setAppState('idle')
      return
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    const tp = throughputRef.current
    if (tp.pendingSteps > 0) { setSteps(s => s + tp.pendingSteps); tp.pendingSteps = 0 }
    wasHaltWaitingRef.current = false
    refresh()
    refreshOutputPorts()
    if (appState === 'running') setAppState('idle')
  }

  function handleRun() {
    if (appState === 'running') {
      stopRun()
      setMsg('⏹ Stopped.')
    } else {
      startRun()
    }
  }

  function handleReset() { doAssemble(srcRef.current) }

function addTraceEntry(prevR) {
    const r = sim.simGetRegisters()
    const d = sim.simDisassemble(prevR.pc)
    const SKIP = new Set(['pc', 'flags', 'halted', 'hasError'])
    const changed = Object.keys(prevR).filter(k => !SKIP.has(k) && typeof prevR[k]==='number' && r[k] !== prevR[k])
    setTrace(t => {
      const entry = { addr: prevR.pc, text: d.text, regs: r, changedKeys: changed }
      return t.length >= 50 ? [...t.slice(1), entry] : [...t, entry]
    })
  }

  function updateMemDiff() {
    const curr = sim.simGetFullMemory()
    if (!prevMemRef.current) { prevMemRef.current = curr; return }
    const changed = new Set()
    for (let i = 0; i < curr.length; i++)
      if (curr[i] !== prevMemRef.current[i]) changed.add(i)
    prevMemRef.current = curr
    setChangedAddrs(changed)
  }

  function syncBps(nextMap) {
    sim.simClearAllBreakpoints()
    for (const addr of nextMap.keys()) sim.simSetBreakpoint(addr)
    setBps(nextMap)
    bpsRef.current = nextMap
  }

  function toggleBp(addr) {
    const next = new Map(bps)
    next.has(addr) ? next.delete(addr) : next.set(addr, null)
    syncBps(next)
  }
  function clearAllBps() { syncBps(new Map()) }

  function toggleDataBp(addr) {
    sim.simSetDataBreakpoint(addr)
    setDataBps(new Set(sim.simGetDataBreakpoints()))
  }
  function clearAllDataBps() {
    sim.simClearAllDataBreakpoints()
    setDataBps(new Set())
  }

  function openConditionDialog(addr) {
    if (!bps.has(addr)) return
    const cur = bps.get(addr) || ''
    setAppDialog({
      type: 'prompt',
      title: `Condition at ${hex4(addr)}H`,
      message: 'Use A B C D E H L PC SP BC DE HL FLAGS S Z AC P CY\n(e.g.  A==0   CY==1   HL>=0x200)\nLeave empty for unconditional:',
      defaultValue: cur,
      onConfirm: (expr) => {
        if (expr === undefined) return
        const next = new Map(bps)
        next.set(addr, expr.trim() || null)
        syncBps(next)
      }
    })
  }

  function exportFile() {
    const blob = new Blob([srcRef.current], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = (fileName.replace(/\.(asm|85|s|txt)$/i,'') || 'program') + '.asm'
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  function exportHex() {
    const mem = sim.simGetFullMemory()
    const start = sim.simGetProgramRegion?.().start ?? 0x100
    const end   = sim.simGetProgramRegion?.().end   ?? 0x100
    if (end <= start) { alert('Assemble the program first.'); return }
    const rows = []
    for (let addr = start; addr < end; addr += 16) {
      const chunk = Math.min(16, end - addr)
      let sum = chunk + (addr >> 8) + (addr & 0xFF)
      let row = `:${hex2(chunk)}${hex4(addr)}00`
      for (let i = 0; i < chunk; i++) { const b = mem[addr + i]; row += hex2(b); sum += b }
      rows.push(row + hex2((-sum) & 0xFF))
    }
    rows.push(':00000001FF')
    const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = (fileName.replace(/\.(asm|85|s|txt)$/i,'') || 'program') + '.hex'
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  function exportBin() {
    const mem = sim.simGetFullMemory()
    const start = sim.simGetProgramRegion?.().start ?? 0x100
    const end   = sim.simGetProgramRegion?.().end   ?? 0x100
    if (end <= start) { alert('Assemble the program first.'); return }
    const blob = new Blob([mem.slice(start, end)], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = (fileName.replace(/\.(asm|85|s|txt)$/i,'') || 'program') + '.bin'
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  function handleDriveDisconnect() {
    if (window.google) window.google.accounts.oauth2.revoke(driveToken, () => {})
    setDriveToken(null)
    setDriveMenuOpen(false)
    setMsg('✓ Disconnected from Google Drive')
  }

  function connectDrive(onSuccess) {
    if (!window.google || !window.google.accounts) {
      setMsg('Loading Google Drive script…')
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.onload = () => connectDrive(onSuccess)
      s.onerror = () => setMsg('✗ Google script blocked by browser or network firewall.')
      document.head.appendChild(s)
      return
    }
    const CLIENT_ID = '467288235889-r6gbjd0ou6ubuiktrnaj54bee6iggr01.apps.googleusercontent.com'
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: async (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          const expiresAt = Date.now() + (tokenResponse.expires_in * 1000 || 3500000)
          localStorage.setItem('sim8085_drive_token', JSON.stringify({ token: tokenResponse.access_token, expiresAt }))
          setDriveToken(tokenResponse.access_token)
          if (typeof onSuccess === 'function') onSuccess(tokenResponse.access_token)
          else setMsg('✓ Connected to Google Drive')
        }
      }
    })
    client.requestAccessToken()
  }

  async function saveToDrive() {
    if (!driveToken) { connectDrive(performSave); return }
    performSave(driveToken)
  }

  async function performSave(token, explicitName) {
    setMsg('Saving to Google Drive…')
    setDriveSaveStatus('saving')
    try {
      let folderId = null
      const query = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='sim8085' and trashed=false")
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, { headers: { Authorization: 'Bearer ' + token } })
      if (searchRes.status === 401) { setDriveToken(null); setMsg('✗ Drive session expired. Please connect again.'); setDriveSaveStatus(null); return }
      const searchData = await searchRes.json()
      if (searchData.files && searchData.files.length > 0) {
        folderId = searchData.files[0].id
      } else {
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'sim8085', mimeType: 'application/vnd.google-apps.folder' })
        })
        const createData = await createRes.json()
        folderId = createData.id
      }

      const nameToUse = explicitName || fileName || 'program'
      const name = nameToUse.replace(/\.(asm|85|s|txt)$/i,'') + '.asm'
      
      let existingFileId = null
      if (folderId) {
        const fileQuery = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`)
        const fileSearchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${fileQuery}`, { headers: { Authorization: 'Bearer ' + token } })
        const fileSearchData = await fileSearchRes.json()
        if (fileSearchData.files && fileSearchData.files.length > 0) {
          existingFileId = fileSearchData.files[0].id
        }
      }

      const metadata = { name, mimeType: 'text/plain' }
      if (!existingFileId && folderId) metadata.parents = [folderId]

      const form = new FormData()
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
      form.append('file', new Blob([srcRef.current], { type: 'text/plain' }))

      const url = existingFileId 
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
      const method = existingFileId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method, headers: { Authorization: 'Bearer ' + token }, body: form
      })
      if (res.status === 401) { setDriveToken(null); setMsg('✗ Drive session expired. Please connect again.'); setDriveSaveStatus(null); return }
      if (res.ok) {
        setMsg(existingFileId ? '✓ File updated on Google Drive!' : '✓ File saved to "sim8085" folder on Google Drive!')
        if (explicitName) { setFileName(name); localStorage.setItem('sim8085_filename', name) }
        setDriveSaveStatus('success')
        setTimeout(() => setDriveSaveStatus(null), 2000)
      } else { setMsg('✗ Error saving to Google Drive.'); setDriveSaveStatus(null) }
    } catch(e) {
      setMsg('✗ Network error saving to Google Drive.')
      setDriveSaveStatus(null)
    }
  }

  function saveAsToDrive() {
    setAppDialog({
      type: 'prompt',
      title: 'Save As (Google Drive)',
      message: 'Enter new file name:',
      defaultValue: fileName || 'program.asm',
      confirmText: 'Save',
      onConfirm: (newName) => {
        if (!newName) return
        const finalName = newName.replace(/\.(asm|85|s|txt)$/i,'') + '.asm'
        if (!driveToken) { connectDrive((token) => performSave(token, finalName)); return }
        performSave(driveToken, finalName)
      }
    })
  }

  async function loadFromDrive() {
    if (!driveToken) { connectDrive(performLoad); return }
    performLoad(driveToken)
  }

  async function performLoad(token) {
    setMsg('Fetching files from "sim8085" folder on Google Drive…')
    setDriveLoading(true)
    setDriveFiles([])
    try {
      const query = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='sim8085' and trashed=false")
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, { headers: { Authorization: 'Bearer ' + token } })
      if (searchRes.status === 401) { setDriveToken(null); setMsg('✗ Drive session expired. Please connect again.'); setDriveFiles(null); setDriveLoading(false); return }
      const searchData = await searchRes.json()
      if (!searchData.files || searchData.files.length === 0) {
        setDriveFiles([]); setDriveLoading(false)
        return
      }
      const folderId = searchData.files[0].id
      const filesQuery = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
      const filesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${filesQuery}&orderBy=modifiedTime desc`, { headers: { Authorization: 'Bearer ' + token } })
      const filesData = await filesRes.json()
      setDriveFiles(filesData.files || [])
    } catch(e) {
      setMsg('✗ Network error loading from Google Drive.')
      setDriveFiles(null)
    } finally { setDriveLoading(false) }
  }

  async function fetchDriveFile(fileId, fileName) {
    setMsg(`Loading ${fileName}…`)
    setDriveFiles(null)
    setActiveChallenge(null)
    try {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${encodeURIComponent(driveToken)}`)
      if (res.status === 401) { setDriveToken(null); setMsg('✗ Drive session expired. Please connect again.'); return }
      if (!res.ok) throw new Error('Failed to fetch')
      const text = await res.text()
      srcRef.current = text; setSrc(text); doAssemble(text)
      setFileName(fileName); localStorage.setItem('sim8085_filename', fileName)
      setMsg(`✓ Loaded ${fileName} from Google Drive`)
    } catch(e) { setMsg(`✗ Error loading file: ${e.message}`) }
  }

  async function deleteDriveFile(fileId, fileName) {
    setAppDialog({
      type: 'confirm',
      title: 'Delete File',
      message: `Are you sure you want to delete "${fileName}" from your Google Drive?`,
      confirmText: 'Delete',
      onConfirm: async () => {
        setDriveFiles(files => files ? files.filter(f => f.id !== fileId) : null)
        setMsg(`Deleting ${fileName}…`)
        try {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?access_token=${encodeURIComponent(driveToken)}`, {
            method: 'DELETE'
          })
          if (res.status === 401) { setDriveToken(null); setMsg('✗ Drive session expired. Please connect again.'); return }
          if (!res.ok) throw new Error('Failed to delete')
          setMsg(`✓ Deleted ${fileName} from Google Drive`)
        } catch(e) { setMsg(`✗ Error deleting file: ${e.message}`) }
      }
    })
  }

  async function loadFromGist(presetId) {
    const load = async (input) => {
      const match = input.match(/[0-9a-f]{20,}/i) || input.match(/^[a-zA-Z0-9_-]+$/)
      const gistId = match ? match[0] : input.trim()
      if (!gistId) return
      setActiveChallenge(null)
      setMsg('Fetching GitHub Gist…')
      try {
        const res = await fetch(`https://api.github.com/gists/${gistId}`)
        if (!res.ok) throw new Error('Gist not found or private')
        const data = await res.json()
        const file = Object.values(data.files).find(f => f.filename.endsWith('.asm') || f.filename.endsWith('.85')) || Object.values(data.files)[0]
        if (!file) throw new Error('No valid files found in Gist')
        srcRef.current = file.content; setSrc(file.content); doAssemble(file.content)
        setFileName(file.filename); localStorage.setItem('sim8085_filename', file.filename)
        setMsg(`✓ Loaded ${file.filename} from GitHub Gist`)
        setActiveView('simulator')
      } catch(e) { setMsg(`✗ Error loading GitHub Gist: ${e.message}`) }
    }

    if (typeof presetId === 'string') {
      load(presetId)
    } else {
      setAppDialog({
        type: 'prompt',
        title: 'Load Gist',
        message: 'Enter a GitHub Gist ID or URL:',
        onConfirm: (input) => { if (input) load(input) }
      })
    }
  }

  async function saveToGist() {
    let token = localStorage.getItem('sim8085_github_token')
    if (!token) {
      setShowGithubSetup(true)
      return
    }
    setMsg('Saving to GitHub Gist…')
    const name = (fileName.replace(/\.(asm|85|s|txt)$/i,'') || 'program') + '.asm'
    try {
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { 'Authorization': `token ${token.trim()}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'sim8085 assembly snippet', public: true, files: { [name]: { content: srcRef.current } } })
      })
      const data = await res.json()
      if (!res.ok) { if (res.status === 401) localStorage.removeItem('sim8085_github_token'); throw new Error(data.message || 'API error') }
      navigator.clipboard.writeText(data.html_url).catch(() => {})
      setMsg(`✓ Saved to GitHub Gist! URL copied to clipboard.`)
    } catch(e) { setMsg(`✗ Error saving GitHub Gist: ${e.message}`) }
  }

  function newFile() {
    const blank = '; New 8085 program\n\tORG 0000H\n\nSTART:\n\n\tHLT\n'
    srcRef.current = blank
    setSrc(blank)
    setFileName('untitled.asm')
    localStorage.removeItem('sim8085_filename')
    doAssemble(blank)
  }

  function importFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setActiveChallenge(null)
    const ext = file.name.split('.').pop().toLowerCase()

    if (ext === 'hex') {
      const reader = new FileReader()
      reader.onload = ev => {
        try {
          const bytes = parseIntelHex(ev.target.result)
          sim.simInit()
          for (const [addr, val] of bytes) sim.simWriteByte(addr, val)
          setMsg(`✓ Loaded ${bytes.size} bytes from ${file.name}`)
          setAppState('idle'); setBuildId(id => id + 1)
          setFileName(file.name); localStorage.setItem('sim8085_filename', file.name)
        } catch(err) { setMsg(`✗ HEX parse error: ${err.message}`) }
        e.target.value = ''
      }
      reader.readAsText(file)
      return
    }

    if (ext === 'bin') {
      setAppDialog({
        type: 'prompt',
        title: 'Load Binary',
        message: `Enter hex start address for ${file.name}:`,
        defaultValue: '0100',
        onConfirm: (inputAddr) => {
          if (!inputAddr) { e.target.value = ''; return }
          let startAddr = parseInt(inputAddr.replace(/h$/i, ''), 16)
          if (isNaN(startAddr) || startAddr < 0 || startAddr > 0xFFFF) {
            startAddr = 0x100
            setAppDialog({ type: 'alert', title: 'Invalid Address', message: 'Invalid hex address. Defaulting to 0100H.' })
          }
          const reader = new FileReader()
          reader.onload = ev => {
            const bytes = new Uint8Array(ev.target.result)
            sim.simInit()
            bytes.forEach((b, i) => sim.simWriteByte(startAddr + i, b))
            setMsg(`✓ Loaded ${bytes.length} bytes from ${file.name} at ${hex4(startAddr)}H`)
            setAppState('idle'); setBuildId(id => id + 1)
            setFileName(file.name); localStorage.setItem('sim8085_filename', file.name)
            e.target.value = ''
          }
          reader.readAsArrayBuffer(file)
        },
        onCancel: () => { e.target.value = '' }
      })
      return
    }

    const reader = new FileReader()
    reader.onload = ev => {
      const code = ev.target.result
      srcRef.current = code; setSrc(code); doAssemble(code)
      setFileName(file.name); localStorage.setItem('sim8085_filename', file.name)
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  function parseIntelHex(text) {
    const bytes = new Map()
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith(':')) continue
      const rec = line.slice(1)
      const count  = parseInt(rec.slice(0,2), 16)
      const addr   = parseInt(rec.slice(2,6), 16)
      const type   = parseInt(rec.slice(6,8), 16)
      if (type === 1) break
      if (type !== 0) continue
      for (let i = 0; i < count; i++)
        bytes.set(addr + i, parseInt(rec.slice(8 + i*2, 10 + i*2), 16))
    }
    return bytes
  }

  function shareURL() {
    const encoded = b64encode(srcRef.current)
    const base = location.href.split('#')[0]
    const url = `${base}#code=${encoded}`
    navigator.clipboard.writeText(url)
      .then(() => setMsg('✓ URL copied to clipboard!'))
      .catch(() => setAppDialog({
        type: 'prompt',
        title: 'Share URL',
        message: 'Copy this URL:',
        defaultValue: url
      }))
  }

  function runToAddr(addr) {
    if (appState === 'error') return
    if (!bpsRef.current.has(addr)) {
      oneShotBpsRef.current.add(addr)
      const next = new Map(bpsRef.current)
      next.set(addr, null)
      syncBps(next)
    }
    startRun()
  }

  function loadExample(key) {
    const sep  = key.indexOf('::')
    const code = EXAMPLES[key.slice(0, sep)]?.[key.slice(sep + 2)]
    if (!code) return
    setActiveChallenge(null)
    srcRef.current = code
    setSrc(code)
    doAssemble(code)
    const name = key.slice(sep + 2)
    setFileName(name); localStorage.setItem('sim8085_filename', name)
  }

  function setInputPort(port, val) {
    sim.simSetInputPort(port, val)
    setInputPresets(ps => {
      const next = ps.filter(p => p.port !== port)
      return [...next, { port, val }].sort((a,b) => a.port - b.port)
    })
  }

  function removeInputPort(port) {
    sim.simClearInputPort(port)
    setInputPresets(ps => ps.filter(p => p.port !== port))
  }

  function enqueueKeys(str) {
    sim.simEnqueueKeys(str)
    setKeyQueue(sim.simGetKeyQueue())
  }
  function clearKeyQueue() {
    sim.simClearKeyQueue()
    setKeyQueue([])
  }

  async function handleEngineSwitch(mode) {
    if (mode === engineMode || engineSwitching) return
    stopRun()
    setEngineSwitching(true)
    setMsg(`Switching to ${mode.toUpperCase()} engine…`)
    const result = await switchEngine(mode)
    setEngineSwitching(false)
    if (!result.ok) {
      setMsg(`✗ WASM unavailable: ${result.error}`)
      setEngineMode('js')
      return
    }
    setEngineMode(mode)
    sim.simInit()
    doAssemble(srcRef.current)
  }

  function changeMemSize(n) {
    memSizeRef.current = n
    _setMemSize(n)
    localStorage.setItem('sim8085_memsize', n)
    doAssemble(srcRef.current)
  }

  function assertInterrupt(type, vec) {
    if (warpWorkerActiveRef.current) {
      warpWorkerRef.current?.postMessage({ cmd: 'assertInterrupt', intType: type })
      return
    }
    sim.simAssertInterrupt(type, vec)
    setIntState(sim.simGetIntState())
  }
  function deassertInterrupt(type) {
    if (warpWorkerActiveRef.current) {
      warpWorkerRef.current?.postMessage({ cmd: 'deassertInterrupt', intType: type })
      return
    }
    sim.simDeassertInterrupt(type)
    setIntState(sim.simGetIntState())
  }

  function formatCode() {
    const formatted = srcRef.current.split('\n').map(line => {
      let comment = ''
      let code = line
      let inStr = false, qChar = null
      for (let i = 0; i < code.length; i++) {
        const c = code[i]
        if (!inStr && (c === '"' || c === "'")) { inStr = true; qChar = c }
        else if (inStr && c === qChar) { inStr = false }
        else if (!inStr && c === ';') { comment = code.slice(i); code = code.slice(0, i); break }
      }
      code = code.trim()
      if (!code) return line.trim() ? '        ' + comment : ''

      let label = ''
      const lMatch = code.match(/^([A-Za-z_][A-Za-z0-9_]*:)\s*(.*)/)
      if (lMatch) { label = lMatch[1]; code = lMatch[2] }
      if (!code) return label + (comment ? '  ' + comment : '')

      const parts = code.match(/^(\S+)\s*(.*)/)
      const mnem = parts[1].toUpperCase()
      const ops = (parts[2] || '').replace(/\s+/g, ' ').trim()

      let out = label ? label.padEnd(8, ' ') : '        '
      if (out.length > 8) out += '\n        '
      out += mnem
      if (ops) out = (out.length >= 16 ? out + ' ' : out.padEnd(16, ' ')) + ops
      if (comment) out = (out.length >= 32 ? out + '  ' : out.padEnd(32, ' ')) + comment
      return out.trimEnd()
    }).join('\n')
    setSrc(formatted)
    srcRef.current = formatted
    setMsg('✓ Code formatted')
  }

  function loadChallenge(c) {
    const code = `; Challenge: ${c.title}\n; ${c.desc}\n\n${c.setup ? c.setup + '\n\n' : ''}    org 100H\n    kickoff 100H\n\n    ; --- YOUR CODE GOES HERE ---\n    ; (Delete the NOP and write your solution)\n    nop\n\n    hlt\n`
    srcRef.current = code
    setSrc(code)
    doAssemble(code)
    setFileName(c.title + '.asm')
    localStorage.setItem('sim8085_filename', c.title + '.asm')
    setChallengeResult(null)
    setActiveChallenge(c)
    setActiveView('simulator')
  }

  useEffect(() => {
    const isRetro = ['amber-mono', 'gray-crt', 'green', 'turbo-c'].includes(theme)
    if (!isRetro || crtGlitch !== 'chaos') { setChaosCalm(false); return }
    let id
    const tick = (calm) => { id = setTimeout(() => { setChaosCalm(!calm); tick(!calm) }, calm ? 1000 : 4000) }
    setChaosCalm(false)
    tick(false)
    return () => clearTimeout(id)
  }, [theme, crtGlitch])

  const running = appState === 'running'
  const isDirty = src !== lastBuiltSrcRef.current
  const isRetroTheme = ['amber-mono', 'gray-crt', 'green', 'turbo-c'].includes(theme)

  return (
    <div className={`app${isRetroTheme && crtGlitch !== 'off' ? ` crt-glitch-${crtGlitch}` : ''}`} style={isRetroTheme ? { filter: `brightness(${crtBrightness}) contrast(${crtContrast})` } : undefined}>
      {isRetroTheme && crtGlitch === 'chaos' && chaosCalm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, pointerEvents: 'none',
          background: 'repeating-linear-gradient(90deg, rgba(255,0,0,.35) 0px, rgba(255,0,0,.35) 1px, rgba(0,255,0,.28) 1px, rgba(0,255,0,.28) 2px, rgba(0,0,255,.35) 2px, rgba(0,0,255,.35) 3px, transparent 3px, transparent 4px)'
        }} />
      )}
      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="brand">
          <BrandMenu
            onShowWelcome={() => { localStorage.removeItem('sim8085_welcomed'); setShowWelcome(true) }}
            onShowShortcuts={() => setShowShortcuts(true)}
            onNew={newFile}
            onImport={() => fileInputRef.current.click()}
            onLoadFromDrive={loadFromDrive}
            onLoadFromGist={loadFromGist}
            onExport={exportFile}
            onExportHex={exportHex}
            onExportBin={exportBin}
            onSaveToDrive={saveToDrive}
            onSaveAsToDrive={saveAsToDrive}
            onSaveToGist={saveToGist}
            driveToken={driveToken}
            onConnectDrive={connectDrive}
            onDriveDisconnect={handleDriveDisconnect}
            onShare={shareURL}
            onCalc={() => setShowCalc(c => !c)}
            onChat={() => setShowChat(c => !c)}
            memSize={memSize} onMemSize={changeMemSize}
            engineMode={engineMode} onEngineSwitch={handleEngineSwitch}
            engineSwitching={engineSwitching}
            theme={theme} onTheme={toggleTheme} onSetTheme={setTheme}
            crtBrightness={crtBrightness} onCrtBrightness={v => { setCrtBrightness(v); localStorage.setItem(`sim8085_crt_b_${theme}`, v) }}
            crtContrast={crtContrast} onCrtContrast={v => { setCrtContrast(v); localStorage.setItem(`sim8085_crt_c_${theme}`, v) }}
            crtGlitch={crtGlitch} onCrtGlitch={() => { const modes = ['off','flicker','static','vsync','hsync','chroma','chaos']; const next = modes[(modes.indexOf(crtGlitch) + 1) % modes.length]; setCrtGlitch(next); localStorage.setItem('sim8085_crt_glitch', next) }}
            onManageGithub={() => setShowGithubSetup(true)}
            panels={panels} onTogglePanel={togglePanel}
            activeView={activeView} onSetView={setActiveView} />
          <div className="view-tabs">
            <button className={`view-tab${activeView === 'simulator' ? ' active' : ''}`} onClick={() => setActiveView('simulator')}>Simulator</button>
            <button className={`view-tab${activeView === 'challenges' ? ' active' : ''}`} onClick={() => setActiveView('challenges')}>Challenges</button>
            <button className={`view-tab${activeView === 'community' ? ' active' : ''}`} onClick={() => setActiveView('community')}>Community</button>
          </div>
        </div>
          {/* Editor/Code/Regs tabs — inline in topbar on mobile, hidden on desktop */}
          {activeView === 'simulator' && (
            <div className="mobile-tabs">
              {[['editor','✏ Editor'],['code','📋 Code'],['regs','🧠 Regs']].map(([id, label]) => (
                <button key={id} className={`mobile-tab${mobileTab===id?' active':''}`} onClick={() => setMobileTab(id)}>{label}</button>
              ))}
            </div>
          )}

        {fileName && <span className="topbar-filename" style={{ marginLeft: 0 }} title={fileName}>File: {fileName}</span>}
        {driveSaveStatus === 'saving' && <span style={{ color: 'var(--text3)', fontSize: 12, alignSelf: 'center', fontFamily: 'var(--mono)', marginLeft: '8px' }}>⏳ Saving…</span>}
        {driveSaveStatus === 'success' && <span style={{ color: 'var(--accent)', fontSize: 12, alignSelf: 'center', fontFamily: 'var(--mono)', marginLeft: '8px' }}>✓ Saved</span>}
        <span className={`engine-chip engine-chip-${engineMode}`} style={{ marginLeft: 'auto' }} title={engineSwitching ? 'Switching engine…' : `Engine: ${engineMode.toUpperCase()}`}>
          {engineSwitching ? '…' : `Engine: ${engineMode.toUpperCase()}`}
        </span>
        <span className="build-chip" title="Build timestamp">Build: {__BUILD_TIME__}</span>
      </div>


      {/* ── Simulator View ── */}
      <div style={{ display: activeView === 'simulator' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="toolbar">
          <ExampleMenu onLoad={loadExample} />
          <PanelsMenu panels={panels} onToggle={togglePanel} />
          <input type="file" ref={fileInputRef} style={{display:'none'}} accept=".asm,.85,.s,.txt,.hex,.bin" onChange={importFile} />
          <button className={`btn btn-asm${isDirty ? ' btn-asm-dirty' : ''}`} onClick={() => doAssemble(srcRef.current)} title={isDirty ? "Unsaved changes — click to rebuild" : "Code is up to date"}>
            ⚙ Build{isDirty ? ' •' : ''}  <kbd>F5</kbd>
          </button>
          {!running && <>
          <button className="btn btn-step"         onClick={doStep}      disabled={appState==='error'}>↓ Step    <kbd>F7</kbd></button>
          <button className="btn btn-step-over"    onClick={doStepOver}  disabled={appState==='error'}>↷ Over    <kbd>F8</kbd></button>
          <button className="btn btn-step-out"     onClick={doStepOut}   disabled={appState==='error'}>↵ Out     <kbd>F10</kbd></button>
          <button className="btn btn-back"         onClick={doStepBack} disabled={appState==='error' || histLen === 0} title={`Undo last step (${histLen} available)`}>⟲ Back{histLen > 0 ? ` (${histLen})` : ''}</button>
          </>}
          <button className={`btn ${running ? 'btn-stop':'btn-run'}`} onClick={handleRun} disabled={!running && appState==='error'}>
            {running ? '■ Stop' : '▶ Run'}  <kbd>{running?'F9':'F9'}</kbd>
          </button>
          <label className="speed-label" title={SPEEDS[runSpeed].warp ? 'Warp: run until HLT, no mid-run UI updates' : SPEEDS[runSpeed].delay ? `Auto: ${SPEEDS[runSpeed].steps} step every ${SPEEDS[runSpeed].delay}ms` : `${SPEEDS[runSpeed].steps.toLocaleString()} steps/tick`}>
            Speed
            <input type="range" min={0} max={SPEEDS.length - 1} value={runSpeed} className="speed-slider"
              onChange={e => {
                const v = +e.target.value; setRunSpeed(v); speedRef.current = v; localStorage.setItem('sim8085_speed', v);
                if (timerRef.current || warpActiveRef.current) { stopRun(); startRun() }
              }} />
            <span className="speed-val">{SPEEDS[runSpeed].label}</span>
          </label>
          <button className="btn btn-reset" onClick={handleReset}>↺ Reset  <kbd>F6</kbd></button>
        </div>

        <div className="workspace">
          {/* Editor column */}
        <div className={`col col-editor${mobileTab!=='editor' ? ' mobile-hidden' : ''}`} ref={editorColRef}>
          <div className="panel editor-panel">
            <div className="panel-hd">
            <span className="panel-icon">✏️</span>EDITOR
            <div className="panel-hd-right">
              <button className="reg-base-btn" onClick={formatCode} title="Auto-format code alignment">Format</button>
              <span className="editor-hint">; semicolons for comments</span>
              <PanelHelp panel="EDITOR" />
            </div>
          </div>
            <AsmEditor value={src} onChange={v => { srcRef.current = v; setSrc(v) }} gotoRef={gotoLineRef}
              onCursorInstruction={setCursorInst}
              onInstructionDetail={setHelpInst}
              errorLine={errorLine}
              onRunTo={runToAddr}
              lineAddrRef={lineAddrRef}
              theme={theme} />
          </div>
          <HelpPanel instruction={cursorInst} />
          <LedDisplay leds={leds} />
        </div>
        <div className="col-resize-handle" onMouseDown={onEditorResizeDown} />

        {/* Code + Memory column */}
        <div className={`col col-center${mobileTab!=='code' ? ' mobile-hidden' : ''}`}>
          <div className="disasm-trace-row">
            <DisasmPanel regs={regs} breakpoints={bps} onToggleBp={toggleBp} onClearAllBps={clearAllBps} buildId={buildId} pcFlash={pcFlash}
              onSetCondition={openConditionDialog}
              onRunTo={runToAddr}
              symbols={symbols}
              onJumpMem={setMemStart}
              hitcnts={hitcnts} maxHit={maxHit}
              onGotoLine={(addr, labelName) => { const ln = addrLineMap.get(addr); if (ln) gotoLineRef.current?.(ln, labelName) }} />
            {(panels.stack || panels.callstack || panels.trace) && (
              <>
                <div className="mem-watch-divider" onMouseDown={onDisasmStackDividerDown} />
                <div className="disasm-trace-stack" ref={disasmStackRef}>
                  {panels.stack     && <StackPanel regs={regs} regBase={regBase} onRegBase={setRegBase} />}
                  {panels.callstack && <CallStackPanel callStack={callStack} onJump={setMemStart} />}
                  {panels.trace     && <TracePanel trace={trace} onClear={() => setTrace([])} />}
                </div>
              </>
            )}
          </div>
          <div className="mem-watch-row">
            <div className="mem-watch-mem" ref={memWatchMemRef}>
              <MemPanel
                memStart={memStart}
                onJump={setMemStart}
                regs={regs}
                buildId={buildId}
                changedAddrs={changedAddrs}
                programRegion={programRegion}
                presetAddrs={presetAddrs}
                onShowDialog={setAppDialog}
              onMemoryEdited={() => setBuildId(id => id + 1)}
              />
            </div>
            <div className="mem-watch-divider" onMouseDown={onMemWatchDividerDown} />
            <div className="mem-watch-watch" ref={memWatchWatchRef}>
              <WatchPanel watches={watches} regs={regs}
                onAdd={w => setWatches(ws => [...ws, w])}
                onRemove={i => {
                  const w = watches[i]
                  if (w.type === 'mem' && dataBps.has(w.addr)) {
                    sim.simClearDataBreakpoint(w.addr)
                    setDataBps(prev => { const n = new Set(prev); n.delete(w.addr); return n })
                  }
                  setWatches(ws => ws.filter((_,j) => j !== i))
                }}
                regBase={regBase} onRegBase={setRegBase}
                dataBps={dataBps} onToggleBreak={toggleDataBp} />
              <ConsolePanel output={consoleOutput} port={consolePort}
                onSetPort={changeConsolePort}
                onClear={() => { sim.simClearConsoleOutput(); setConsoleOutput('') }} />
            </div>
          </div>
          <div className="jump-row">
            <button className="btn btn-xs" onClick={()=>setMemStart(regs.pc & 0xFFF0)}>→ PC</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(regs.sp & 0xFFF0)}>→ SP</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(0x100)}>→ 100H</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(0x200)}>→ 200H</button>
          </div>
        </div>
        <div className="col-resize-handle" onMouseDown={onRightResizeDown} />

        {/* Registers column */}
        <div className={`col col-right${mobileTab!=='regs' ? ' mobile-hidden' : ''}`} ref={rightColRef}>
          {panels.regs      && <RegPanel   regs={regs} prev={prevRegs} onJump={setMemStart} regBase={regBase} onRegBase={setRegBase} onEdit={refresh} onShowDialog={setAppDialog} />}
          {panels.pairs     && <PairPanel  regs={regs} prev={prevRegs} onJump={setMemStart} onEdit={refresh} regBase={regBase} onRegBase={setRegBase} onMemoryEdited={() => setBuildId(id => id + 1)} />}
          {panels.flags     && <FlagPanel  regs={regs} />}
          {panels.ints      && <IntPanel intState={intState} onAssert={assertInterrupt} onDeassert={deassertInterrupt} />}
          {panels.io        && <IOPortPanel outputPorts={outputPorts} inputPresets={inputPresets}
            onSetInput={setInputPort} onRemoveInput={removeInputPort}
            keyQueue={keyQueue} onEnqueueKeys={enqueueKeys} onClearKeyQueue={clearKeyQueue}
            sid={sid} sod={sod} onSetSID={v => { sim.simSetSID(v); setSid(v); }} />}
          {panels.memmap    && <MemMapPanel regs={regs} programRegion={programRegion} presetAddrs={presetAddrs} />}
          {panels.audio     && <AudioPanel outputPorts={outputPorts} running={running} />}
        </div>
      </div>
      </div>

      {activeView === 'challenges' && (
        <ChallengesView onSelect={loadChallenge} />
      )}

      {activeView === 'community' && (
        <CommunityView onSelect={loadFromGist} githubToken={localStorage.getItem('sim8085_github_token')} />
      )}

      <div className="statusbar">
        <span className="statusbar-label">LAST EVENT</span>
        <div className="statusbar-events">
          {statusLog.length === 0
            ? <span className="statusbar-empty">—</span>
            : (() => { const e = statusLog[statusLog.length - 1]; return (
              <div className={`statusbar-entry sbar-${e.kind}`}>
                <span className="statusbar-text">{e.text}</span>
              </div>
            )})()
          }
        </div>
        <div className="statusbar-counters">
          {isDirty && <><span className="sbar-counter" style={{ color: 'var(--amber)', fontWeight: 600 }}>• editor out of sync</span><span className="sbar-sep">·</span></>}
          <span className="sbar-counter sc-steps" title={`${steps.toLocaleString()} instructions executed`}>{fmtCount(steps)} steps</span>
          <span className="sbar-sep">·</span>
          <span className="sbar-counter sc-cycles" title={`${cycles.toLocaleString()} T-states elapsed`}>{fmtCount(cycles)} T</span>
          <span className="sbar-sep">·</span>
          <span className="sbar-counter sc-mhz" title="Simulated throughput">{mhz >= 1000 ? `${(mhz/1000).toFixed(2)} GHz` : mhz >= 1 ? `${mhz.toFixed(2)} MHz` : `${(mhz*1000).toFixed(2)} kHz`}</span>
        </div>
      </div>
      {showWelcome && <WelcomeModal onClose={dismissWelcome} />}
      {helpInst && <HelpModal instruction={helpInst} onClose={() => setHelpInst(null)} />}
      
      {activeView === 'simulator' && (
        <>
          {showCalc && <CalcFloat onClose={() => setShowCalc(false)} />}
          {panels.ppi && <PPI8255Panel outputPorts={outputPorts} inputPresets={inputPresets} onSetInput={setInputPort} onClose={() => togglePanel('ppi')} />}
          {panels.pit && <PIT8253Panel outputPorts={outputPorts} onClose={() => togglePanel('pit')} />}
        </>
      )}

      {showChat && <ChatPanel regs={regs} src={src} onClose={() => setShowChat(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {driveFiles !== null && <DriveLoadModal files={driveFiles} loading={driveLoading} onClose={() => setDriveFiles(null)} onSelect={fetchDriveFile} onDelete={deleteDriveFile} />}
      {showGithubSetup && <GithubSetupModal onClose={() => setShowGithubSetup(false)} onSave={() => setMsg('✓ GitHub token saved.')} />}
      {challengeResult && (
        <div className="help-overlay" onClick={() => setChallengeResult(null)}>
          <div className="welcome-modal" style={{ width: 400, maxWidth: '90vw', textAlign: 'center', padding: '30px 20px', display: 'block' }} onClick={e => e.stopPropagation()}>
             <div style={{ fontSize: 50, marginBottom: 16 }}>{challengeResult.passed ? '🏆' : '❌'}</div>
             <h2 style={{ color: challengeResult.passed ? 'var(--accent)' : 'var(--red)', marginBottom: 12, fontFamily: 'var(--mono)' }}>{challengeResult.passed ? 'CHALLENGE PASSED!' : 'CHALLENGE FAILED'}</h2>
             <p style={{ color: 'var(--text2)', lineHeight: 1.5 }}>{challengeResult.msg}</p>
             <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: 24 }}>
               <button className="btn" style={{ fontSize: 14, padding: '6px 16px' }} onClick={() => setChallengeResult(null)}>{challengeResult.passed ? 'Awesome!' : 'Keep Trying'}</button>
               <button className="btn" style={{ fontSize: 14, padding: '6px 16px' }} onClick={() => loadChallenge(activeChallenge)}>Restart Challenge</button>
             </div>
          </div>
        </div>
      )}
      {appDialog && <UIDialog dialog={appDialog} onClose={() => setAppDialog(null)} />}
    </div>
  )
}
