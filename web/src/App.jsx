import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration } from '@codemirror/view'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { oneDarkTheme } from '@codemirror/theme-one-dark'
import * as sim from './sim8085Bridge.js'
import { EXAMPLES } from './examples.js'
import { INST_HELP } from './instHelp.js'
import { hex2, hex4, b64encode, b64decode, BASE_CYCLE, SPEEDS, fmtByte, fmtWord, TRACE_REG16, fmtTraceVal, evalCondition, fmtCount } from './utils.js'
import { asm8085Lang, asm8085Highlighting } from './lang.js'
import './App.css'

// ── CM6 error-line decoration ─────────────────────────────────────────────
const setErrorLineEff = StateEffect.define()
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
• Pseudo-ops: SETBYTE, SETWORD, ASSERT, KICKOFF (highlighted red)`,

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

  'MEMORY': `• Hex dump of the full 16 KB RAM
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
• Press Fill range to write the byte across the range`,

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
  const ON = '#FF2200', OFF = 'rgba(255,34,0,0.15)'
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
function AsmEditor({ value, onChange, onCursorInstruction, onInstructionDetail, errorLine, gotoRef, onRunTo, lineAddrRef }) {
  const elRef      = useRef(null)
  const viewRef    = useRef(null)
  const syncing    = useRef(false)
  const cursorCb   = useRef(onCursorInstruction)
  const detailCb   = useRef(onInstructionDetail)
  const onRunToRef = useRef(onRunTo)
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
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          oneDarkTheme,
          asm8085Lang.extension,
          asm8085Highlighting,
          errorLineField,
          EditorView.theme({
            '&': { height:'100%', fontFamily:'"JetBrains Mono","Fira Code",monospace', fontSize:'15px' },
            '.cm-scroller': { overflow:'auto' },
            '.cm-content': { padding:'8px 0', minHeight:'100%' },
            '.cm-error-line': { background: 'rgba(255,60,60,0.18)' },
            '.cm-search': { background:'#1a1a2e', borderTop:'1px solid #333', padding:'4px 8px', gap:'6px' },
            '.cm-search input': { background:'#111', border:'1px solid #444', color:'#e0e0e0', borderRadius:'3px', padding:'2px 6px' },
            '.cm-button': { background:'#2a2a3e', border:'1px solid #555', color:'#ccc', borderRadius:'3px', padding:'2px 8px', cursor:'pointer' },
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
    view.dispatch({ changes: { from:0, to:view.state.doc.length, insert:value } })
    syncing.current = false
  }, [value])

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

function RegPanel({ regs, prev, onJump, regBase, onRegBase, onEdit }) {
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
        if (regKey === 'pc' && !window.confirm(`Move instruction pointer to ${hex4(n)}H?\nThe next step will execute from that address.`)) { setEditing(false); return }
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
      <div className="panel-hd">
        <span className="panel-icon">🧠</span>REGISTERS
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => onRegBase(nextBase)}
            title="Toggle display: hex / dec / bin">{regBase.toUpperCase()}</button>
          <PanelHelp panel="REGISTERS" />
        </div>
      </div>
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
    </div>
  )
}

// ── Register pairs panel ─────────────────────────────────────────────────
const PAIR_DEFS = [
  { name: 'BC', hi: 'b', lo: 'c' },
  { name: 'DE', hi: 'd', lo: 'e' },
  { name: 'HL', hi: 'h', lo: 'l' },
]

function PairPanel({ regs, prev, onJump, onEdit, regBase, onRegBase }) {
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
      }
      onEdit()
    }
    setEditing(null)
  }

  return (
    <div className="panel reg-panel">
      <div className="panel-hd">
        <span className="panel-icon">🔗</span>REGISTER PAIRS
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="REGISTER PAIRS" />
        </div>
      </div>
      <div className="pair-col-hdr">
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
      })}
    </div>
  )
}

// ── Flags panel ──────────────────────────────────────────────────────────
function FlagPanel({ regs }) {
  const FLAGS = [
    { label:'S',  key:'flagS',  title:'Sign — result was negative' },
    { label:'Z',  key:'flagZ',  title:'Zero — result was zero' },
    { label:'AC', key:'flagAC', title:'Auxiliary Carry — carry from bit 3' },
    { label:'P',  key:'flagP',  title:'Parity — even number of 1-bits' },
    { label:'CY', key:'flagCY', title:'Carry — result overflowed' },
  ]
  return (
    <div className="panel flag-panel">
      <div className="panel-hd"><span className="panel-icon">🚩</span>FLAGS<PanelHelp panel="FLAGS" /></div>
      <div className="flags-row">
        {FLAGS.map(f => (
          <div key={f.key} className={`flag${regs[f.key] ? ' flag-on' : ''}`} title={f.title}>
            <div className="flag-lbl">{f.label}</div>
            <div className="flag-val">{regs[f.key]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Disassembly panel ────────────────────────────────────────────────────
function DisasmPanel({ regs, breakpoints, onToggleBp, onClearAllBps, onSetCondition, onGotoLine, buildId, pcFlash, onRunTo, jumpRef, symbols, onJumpMem }) {
  const [viewStart, setViewStart] = useState(() => regs.pc)
  const [ctxMenu, setCtxMenu]     = useState(null)   // {addr, x, y}
  const [followPC, setFollowPC]   = useState(true)
  const [addrInput, setAddrInput] = useState('')
  const [showBpList, setShowBpList] = useState(false)
  const curRowRef = useRef(null)

  useEffect(() => { if (jumpRef) jumpRef.current = setViewStart }, [jumpRef])

  const addrToLabel = useMemo(() => {
    const m = new Map()
    for (const [name, addr] of Object.entries(symbols || {})) m.set(addr, name)
    return m
  }, [symbols])

  const lines = useMemo(() => {
    const out = []
    let addr = viewStart
    for (let i = 0; i < 100 && addr < 0x4000; i++) {
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
  useEffect(() => { linesRef.current = lines }, [lines])

  // Build a complete address index by scanning all memory from 0 on each build.
  // Uninitialized RAM is 0x00 (NOP, 1 byte) so alignment from address 0 is always correct.
  useEffect(() => {
    const idx = []
    let addr = 0
    while (addr <= 0x3FFF) { idx.push(addr); const d = sim.simDisassemble(addr); addr += Math.max(1, d.len) }
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
      curRowRef.current?.scrollIntoView({ block: 'nearest' })
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
      if (!hoveredRef.current) return
      const ls = linesRef.current
      const idx = addrIdxRef.current
      const step = (vs, delta) => {
        const i = findIdx(vs)
        return idx[Math.max(0, Math.min(idx.length - 1, i + delta))]
      }
      const pageRows = listRef.current ? Math.max(1, Math.floor(listRef.current.clientHeight / 20) - 1) : 15
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setViewStart(vs => step(vs, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setViewStart(vs => step(vs, -1))
      } else if (e.key === 'PageDown') {
        e.preventDefault(); setViewStart(vs => step(vs, pageRows))
      } else if (e.key === 'PageUp') {
        e.preventDefault(); setViewStart(vs => step(vs, -pageRows))
      } else if (e.key === 'Home') {
        e.preventDefault(); setViewStart(0)
      } else if (e.key === 'End') {
        e.preventDefault(); setViewStart(0x3F00)
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
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = parseInt(addrInput, 16)
                if (!isNaN(v)) { setViewStart(v & 0x3FFF); setFollowPC(false) }
                setAddrInput('')
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
              <span className="disasm-text">{row.text}</span>
              {cond && bp && <span className="disasm-cond">{cond}</span>}
              {row.cycles > 0 && <span className="disasm-cycles">{row.cycles}T</span>}
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
function MemPanel({ memStart, onJump, regs, buildId, changedAddrs, programRegion, presetAddrs }) {
  const [mem, setMem] = useState(new Uint8Array(128))
  const [editing, setEditing] = useState(null)
  const [editBuf, setEditBuf] = useState('')
  const [rows, setRows] = useState(8)
  const [addrBuf, setAddrBuf] = useState(hex4(memStart))
  const [cursor, setCursor] = useState(memStart)
  const [showSearch, setShowSearch] = useState(false)
  const [showFill, setShowFill]     = useState(false)
  const [searchVal, setSearchVal]   = useState('')
  const [searchMatches, setSearchMatches] = useState([])
  const [searchIdx, setSearchIdx]   = useState(0)
  const [fillFrom, setFillFrom]     = useState('')
  const [fillTo, setFillTo]         = useState('')
  const [fillVal, setFillVal]       = useState('')
  const [searchRan, setSearchRan]   = useState(false)
  const addrFocused = useRef(false)
  const COLS = 16
  const scrollRef = useRef(null)
  const panelRef  = useRef(null)

  const searchMatchSet  = useMemo(() => new Set(searchMatches), [searchMatches])
  const fillPreviewSet  = useMemo(() => {
    if (!showFill) return new Set()
    const from = parseInt(fillFrom, 16), to = parseInt(fillTo, 16)
    if (isNaN(from) || isNaN(to)) return new Set()
    const start = Math.min(from, to) & 0x3FFF
    const end   = Math.min(Math.max(from, to) & 0x3FFF, 0x3FFF)
    const s = new Set()
    for (let a = start; a <= end; a++) s.add(a)
    return s
  }, [showFill, fillFrom, fillTo])

  useEffect(() => { if (!addrFocused.current) setAddrBuf(hex4(memStart)) }, [memStart])

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
    const startH = panelRef.current.getBoundingClientRect().height
    function onMove(ev) {
      panelRef.current.style.height = Math.max(80, startH + (startY - ev.clientY)) + 'px'
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
    if (!isNaN(v)) sim.simWriteByte(addr, v)
    setEditing(null)
    refresh()
  }

  function moveCursor(delta) {
    const next = Math.max(0, Math.min(0xFFFF, cursor + delta))
    setCursor(next)
    const visEnd = memStart + COLS * rows - 1
    if (next < memStart) {
      onJump((next >> 4) << 4)
    } else if (next > visEnd) {
      onJump(Math.max(0, ((next >> 4) << 4) - COLS * (rows - 1)))
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
    const allMem = sim.simGetMemory(0, 0x4000)
    const matches = []
    for (let i = 0; i < 0x4000; i++) {
      if (allMem[i] === (v & 0xFF)) matches.push(i)
    }
    setSearchMatches(matches)
    setSearchIdx(0)
    setSearchRan(true)
    if (matches.length > 0) onJump(matches[0] & 0xFFF0)
  }

  function searchNav(dir) {
    if (searchMatches.length === 0) return
    const idx = (searchIdx + dir + searchMatches.length) % searchMatches.length
    setSearchIdx(idx)
    onJump(searchMatches[idx] & 0xFFF0)
  }

  function runFill() {
    const from = parseInt(fillFrom, 16)
    const to   = parseInt(fillTo, 16)
    const val  = parseInt(fillVal, 16)
    if (isNaN(from) || isNaN(to) || isNaN(val)) return
    const start = Math.min(from, to) & 0x3FFF
    const end   = Math.min(Math.max(from, to) & 0x3FFF, 0x3FFF)
    for (let a = start; a <= end; a++) sim.simWriteByte(a, val & 0xFF)
    refresh()
  }

  return (
    <div className="panel mem-panel" ref={panelRef} tabIndex={0} onKeyDown={onPanelKey}>
      <div className="mem-resize-handle" onMouseDown={onHandleMouseDown} />
      <div className="panel-hd">
        <span className="panel-icon">💾</span>MEMORY
        <div className="panel-hd-right">
        <span className="mem-ctrl">
          <button className="mem-btn" title="Back 4 pages" onClick={() => onJump(Math.max(0, memStart - COLS*rows*4))}>«</button>
          <button className="mem-btn" onClick={() => onJump(Math.max(0, memStart - COLS*rows))}>◀</button>
          <input
            className="mem-cur-addr"
            value={addrBuf}
            maxLength={4}
            spellCheck={false}
            onChange={e => setAddrBuf(e.target.value.toUpperCase())}
            onFocus={e => { addrFocused.current = true; e.target.select() }}
            onBlur={() => { addrFocused.current = false; setAddrBuf(hex4(memStart)) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { const v = parseInt(addrBuf, 16); if (!isNaN(v)) onJump(v & 0xFFF0); e.target.blur() }
              if (e.key === 'Escape') { setAddrBuf(hex4(memStart)); e.target.blur() }
            }}
          />
          <button className="mem-btn" onClick={() => onJump(Math.min(0x3F00, memStart + COLS*rows))}>▶</button>
          <button className="mem-btn" title="Forward 4 pages" onClick={() => onJump(Math.min(0x3F00, memStart + COLS*rows*4))}>»</button>
        </span>
        <span style={{width:8, flexShrink:0}} />
        <button className={`mem-btn${showSearch ? ' mem-btn-active' : ''}`}
          title="Find byte in memory (toggle)"
          onClick={() => { setShowSearch(s => !s); setShowFill(false) }}>🔍</button>
        <button className={`mem-btn${showFill ? ' mem-btn-active' : ''}`}
          title="Fill memory range (toggle)"
          onClick={() => { setShowFill(s => !s); setShowSearch(false) }}>⊞</button>
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
      <div className="mem-scroll" ref={scrollRef}
        onWheel={e => { e.preventDefault(); const delta = e.deltaY > 0 ? COLS : -COLS; onJump(Math.max(0, Math.min(0x3F00, memStart + delta))) }}>
        <table className="mem-tbl">
          <thead>
            <tr>
              <th className="mem-th-addr"></th>
              {Array.from({length:COLS},(_,i)=><th key={i} className="mem-th">{hex2(i)}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({length:rows},(_,row)=>{
              const base = memStart + row*COLS
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
                    const isFillPrev = !isPC && !isSP && !isMatchCur && !isMatch && fillPreviewSet.has(addr)
                    if (editing === addr)
                      return (
                        <td key={col} className="mem-cell editing">
                          <input autoFocus maxLength={2} value={editBuf}
                            onChange={e=>setEditBuf(e.target.value.toUpperCase())}
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

function ChatPanel({ regs, src }) {
  const [apiKey,      setApiKey]      = useState(() => localStorage.getItem('ant_key') || '')
  const [keyDraft,    setKeyDraft]    = useState('')
  const [setupOpen,   setSetupOpen]   = useState(!localStorage.getItem('ant_key'))
  const [messages,    setMessages]    = useState([])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const scrollRef  = useRef(null)
  const inputRef   = useRef(null)
  const panelRef   = useRef(null)

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

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY, startH = panelRef.current.getBoundingClientRect().height
    const onMove = ev => { panelRef.current.style.height = Math.max(80, startH + (startY - ev.clientY)) + 'px' }
    const onUp   = ()  => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel chat-panel" ref={panelRef}>
      <div className="chat-resize-handle" onMouseDown={onResizeDown} />
      <div className="panel-hd">
        <span className="panel-icon">🤖</span>AI ASSISTANT
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => setSetupOpen(o => !o)} title="API key settings">⚙</button>
          <PanelHelp panel="AI ASSISTANT" />
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
  const panelRef = useRef(null)
  const entries = useMemo(() => {
    const out = []
    for (let i = 0; i < 64; i++) {
      const a = (regs.sp + i*2) & 0xFFFF
      if (a >= 0x4000) break
      out.push({ addr: a, val: sim.simReadByte(a) | (sim.simReadByte(a+1)<<8) })
    }
    return out
  }, [regs.sp])

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY, startH = panelRef.current.getBoundingClientRect().height
    const onMove = ev => { panelRef.current.style.height = Math.max(72, startH + (ev.clientY - startY)) + 'px' }
    const onUp   = ()  => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel stack-panel" ref={panelRef}>
      <div className="panel-hd">
        <span className="panel-icon">📚</span>STACK
        <div className="panel-hd-right">
          <code className="sp-val">SP={hex4(regs.sp)}</code>
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="STACK" />
        </div>
      </div>
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
  const bodyRef = useRef(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [trace])

  return (
    <div className="panel trace-panel">
      <div className="panel-hd">
        <span className="panel-icon">📜</span>TRACE
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={onClear} title="Clear trace">✕</button>
          <PanelHelp panel="TRACE" />
        </div>
      </div>
      <div className="trace-body" ref={bodyRef}>
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
                    const name = FLAG_SHORT[k] ?? k.toUpperCase()
                    const val  = FLAG_SHORT[k] ? e.regs[k] : fmtTraceVal(k, e.regs[k])
                    return `${name}=${val}`
                  }).join(' ')}
                </span>
              }
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── Watch panel ──────────────────────────────────────────────────────────
function WatchPanel({ watches, regs, onAdd, onRemove, regBase, onRegBase }) {
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
              return (
                <div key={i} className="watch-row">
                  <span className="watch-label">{label}</span>
                  <span className="watch-val">{is16(w) ? fmtWord(v, regBase) : fmtByte(v, regBase)}</span>
                  {(regBase||'hex') === 'hex' && <span className="watch-dec">{v}</span>}
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
function IOPortPanel({ outputPorts, inputPresets, onSetInput, onRemoveInput, keyQueue, onEnqueueKeys, onClearKeyQueue }) {
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
      <div className="panel-hd"><span className="panel-icon">🔌</span>I/O PORTS<PanelHelp panel="I/O PORTS" /></div>

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
    </div>
  )
}

// ── Interrupt panel ──────────────────────────────────────────────────────
function IntPanel({ intState, onAssert, onDeassert }) {
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
      <div className="panel-hd">
        <span className="panel-icon">⚡</span>INTERRUPTS
        <PanelHelp panel="INTERRUPTS" />
      </div>
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
    </div>
  )
}

// ── Example submenu ──────────────────────────────────────────────────────
function ExampleMenu({ onLoad }) {
  const [open, setOpen]         = useState(false)
  const [activeCat, setActiveCat] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => { if (!wrapRef.current?.contains(e.target)) { setOpen(false); setActiveCat(null) } }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="exmenu-wrap" ref={wrapRef}>
      <button className="btn exmenu-trigger" onClick={() => setOpen(o => !o)}>
        Examples <span className="exmenu-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="exmenu-dropdown">
          {Object.entries(EXAMPLES).map(([cat, programs], i) => (
            <div key={cat}>
              {i === 1 && <hr className="exmenu-sep" />}
              <div
                className={`exmenu-cat${activeCat === cat ? ' exmenu-cat-active' : ''}`}
                onMouseEnter={() => setActiveCat(cat)}
              >
                <span>{cat}</span>
                <span className="exmenu-arrow">▶</span>
                {activeCat === cat && (
                  <div className="exmenu-sub">
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
    </div>
  )
}

// ── Brand menu ───────────────────────────────────────────────────────────
function BrandMenu({ onShowWelcome, onShowShortcuts, onImport, onExport, onShare, onCalc, memSize, onMemSize }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function item(label, action) {
    return (
      <button className="bmenu-item" onClick={() => { action(); setOpen(false) }}>
        {label}
      </button>
    )
  }

  return (
    <div className="bmenu-wrap" ref={wrapRef}>
      <button className="brand-chip bmenu-trigger" onClick={() => setOpen(o => !o)} title="Menu">
        <span className="brand-chevron">☰</span> 8085
      </button>
      {open && (
        <div className="bmenu-dropdown">
          {item('⇡  Import .asm / .85', onImport)}
          {item('⇣  Export .asm', onExport)}
          {item('⎘  Copy share link', onShare)}
          <div className="bmenu-sep" />
          {item('🖩  Calculator', onCalc)}
          {item('📖  Welcome guide', onShowWelcome)}
          {item('⌨  Keyboard shortcuts  ?', onShowShortcuts)}
          <div className="bmenu-sep" />
          {item('⭐  View on GitHub',  () => window.open('https://github.com/selfmodify/sim8085wasm', '_blank'))}
          {item('🐛  Report a Bug',    () => window.open('https://github.com/selfmodify/sim8085wasm/issues/new', '_blank'))}
          {item('💬  Ask a Question',  () => window.open('https://github.com/selfmodify/sim8085wasm/discussions', '_blank'))}
          <div className="bmenu-sep" />
          <div className="bmenu-setting">
            <span className="bmenu-setting-label">RAM size</span>
            <select className="bmenu-setting-sel" value={memSize}
              onChange={e => { onMemSize(+e.target.value); setOpen(false) }}>
              <option value={16*1024}>16 KB</option>
              <option value={32*1024}>32 KB</option>
              <option value={64*1024}>64 KB</option>
            </select>
          </div>
          <div className="bmenu-credits">
            <div>8085 Simulator</div>
            <div>Original: V. Kumar · 1995</div>
            <div>Web port: 2026</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Welcome modal ────────────────────────────────────────────────────────
const WELCOME_FEATURES = [
  { icon: '✏️', title: 'Editor',          desc: 'Write 8085 assembly with syntax highlighting and auto-indent. Ctrl+click any mnemonic for the full instruction reference. Load from 20+ built-in examples across six categories.' },
  { icon: '▶',  title: 'Build & Run',     desc: 'F5 assembles, F7 steps one instruction, F9 runs/pauses, F6 resets. ⟲ Back undoes the last step. Use the speed slider to go from single-step up to turbo.' },
  { icon: '📋', title: 'Disassembly',     desc: 'Live disassembly follows the program counter. Click any row to toggle a breakpoint — execution pauses automatically when PC hits it.' },
  { icon: '🧠', title: 'CPU State',       desc: 'Registers, flags, and register pairs update live and highlight green on every change. Click any register pair to jump the memory view to that address. Values are editable in place.' },
  { icon: '💾', title: 'Memory',          desc: 'Browse and edit all of RAM in the hex editor. Double-click any cell to change it. RAM size is configurable (16 / 32 / 64 KB) in the menu.' },
  { icon: '💡', title: 'LED Display',     desc: 'The 7-segment LED display is driven by Intel SDK CALL 5 system calls. Load "LED Count" or "LED Scroll" from the I/O examples to see it in action.' },
  { icon: '🔔', title: 'Interrupts',      desc: 'Fire TRAP, RST 7.5, RST 6.5, or RST 5.5 mid-program with the FIRE buttons. Control the interrupt flip-flop via EI/DI/SIM/RIM. HLT pauses and resumes on the next interrupt.' },
  { icon: '🔌', title: 'I/O & Keyboard',  desc: 'Pre-set input port values returned by the IN instruction. Queue keystrokes for the CALL 5 C=01H read-key syscall. Try the "Keyboard Read" example under I/O.' },
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
          <span className="welcome-tip">💡 Start with Examples → I/O → LED Count to see the display in action, or Examples → Interrupts → TRAP to try the interrupt system.</span>
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

// ── Root app ─────────────────────────────────────────────────────────────
export default function App() {
  const [src, setSrc]           = useState(() => {
    try {
      const hash = location.hash
      if (hash.startsWith('#code=')) { const d = b64decode(hash.slice(6)); if (d) return d }
      const saved = localStorage.getItem('sim8085_program')
      if (saved) return saved
    } catch {}
    return EXAMPLES['I/O']['LED Scroll']
  })
  const [regs, setRegs]         = useState({a:0,b:0,c:0,d:0,e:0,h:0,l:0,flags:0,pc:0x100,sp:0,flagS:0,flagZ:0,flagAC:0,flagP:0,flagCY:0,halted:false,hasError:false})
  const [prevRegs, setPrev]     = useState(null)
  const [leds, setLeds]         = useState(Array(8).fill(0))
  const [bps, setBps]           = useState(new Map())   // Map<addr, string|null>
  const [trace, setTrace]       = useState([])
  const [changedAddrs, setChangedAddrs] = useState(new Set())
  const [watches, setWatches]   = useState([])
  const [outputPorts, setOutputPorts] = useState([])      // [{port,val}] written by OUT
  const [inputPresets, setInputPresets] = useState([])    // [{port,val}] preset for IN
  const [keyQueue, setKeyQueue]   = useState([])          // chars queued for C=01H syscall
  const [intState, setIntState] = useState(() => sim.simGetIntState())
  const [memStart, setMemStart] = useState(0x100)
  const [appState, setAppState] = useState('idle')  // idle | running | halted | error
  const [msg, setMsg]           = useState('Load an example or write code, then click Build.')
  const [steps, setSteps]       = useState(0)
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
  const [showWelcome,    setShowWelcome]    = useState(() => !localStorage.getItem('sim8085_welcomed'))
  const [showCalc,       setShowCalc]       = useState(false)
  const [showShortcuts,  setShowShortcuts]  = useState(false)
  function dismissWelcome() { localStorage.setItem('sim8085_welcomed', '1'); setShowWelcome(false) }
  const [runSpeed, setRunSpeed]     = useState(3)        // index into SPEEDS
  const MEM_SIZES = [16*1024, 32*1024, 64*1024]
  const [memSize, _setMemSize] = useState(() => {
    const s = parseInt(localStorage.getItem('sim8085_memsize'), 10)
    return MEM_SIZES.includes(s) ? s : 64*1024
  })
  const memSizeRef = useRef(memSize)
  const [regBase, setRegBase]       = useState('hex')    // 'hex'|'dec'|'bin'
  const [statusLog, setStatusLog]   = useState([])
  const [histLen, setHistLen]       = useState(0)        // for disabling Step Back button
  const timerRef    = useRef(null)
  const editorColRef = useRef(null)
  const rightColRef  = useRef(null)
  const gotoLineRef  = useRef(null)
  const lineAddrRef  = useRef(new Map())  // lineNumber → address (reverse of addrLineMap)
  const fileInputRef   = useRef(null)
  const oneShotBpsRef  = useRef(new Set())
  const disasmJumpRef  = useRef(null)
  const memWatchMemRef = useRef(null)
  const [addrLineMap, setAddrLineMap] = useState(new Map())
  const srcRef      = useRef(src)
  const speedRef    = useRef(3)
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

  useEffect(() => { sim.simInit(); doAssemble(src) }, [])

  const hotkeysRef = useRef(null)
  useEffect(() => { hotkeysRef.current = { doAssemble, handleReset, doStep, handleRun, running, appState } })
  useEffect(() => {
    function onKey(e) {
      const h = hotkeysRef.current
      if (e.key === 'F5') { e.preventDefault(); h.doAssemble(srcRef.current) }
      if (e.key === 'F6') { e.preventDefault(); h.handleReset() }
      if (e.key === 'F7') { e.preventDefault(); if (!h.running && h.appState !== 'error') h.doStep() }
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
    const kind = msg.startsWith('✗') ? 'error' : msg.startsWith('✓') ? 'success' : msg.startsWith('■') ? 'halted' : 'info'
    setStatusLog(log => [...log.slice(-19), { text: msg, kind, t }])
  }, [msg])

  function refresh() {
    const r = sim.simGetRegisters()
    setRegs(old => { setPrev(old); return r })
    setLeds(sim.simGetAllLeds())
    setCycles(sim.simGetCycles())
    setIntState(sim.simGetIntState())
    setKeyQueue(sim.simGetKeyQueue())
    setConsoleOutput(sim.simGetConsoleOutput())
  }

  function changeConsolePort(n) {
    sim.simSetConsolePort(n)
    setConsolePort(n)
  }

  function refreshOutputPorts() {
    setOutputPorts(sim.simGetOutputPorts())
  }

  function doAssemble(code) {
    try {
      stopRun()
      historyRef.current = []
      setHistLen(0)
      setTrace([])
      setChangedAddrs(new Set())
      setOutputPorts([])
      setKeyQueue([])
      setConsoleOutput('')
      prevMemRef.current = null
      sim.simSetMemorySize(memSizeRef.current)
      sim.simInit()
      const res = sim.simAssemble(code)
      setBuildId(id => id + 1)
      setSteps(0)
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
        const t = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})
        setMsg(`✓ ${res.bytesEmitted}B at ${hex4(res.entryPoint)}H — ready  ${t}`)
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

  function doStep() {
    stopRun()
    pushHistory()
    const prevR = sim.simGetRegisters()
    const ok = sim.simStep()
    setSteps(s => s+1)
    setPcFlash(f => f+1)
    refresh()
    addTraceEntry(prevR)
    updateMemDiff()
    refreshOutputPorts()
    if (sim.simIsHaltWaiting()) {
      setAppState('halted')
      setMsg('⏸ HLT — awaiting interrupt…')
    } else if (!sim.simIsRunning()) {
      setAppState(sim.simGetError() ? 'error' : 'halted')
      setMsg(sim.simGetError() ? `✗ ${sim.simGetError()}` : '■ Program halted.')
    } else if (!ok) {
      setAppState('idle')  // interrupt fired from HLT wait, ISR starting
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

  function startRun() {
    if (timerRef.current) return
    setAppState('running')
    setMsg('▶ Running…')
    timerRef.current = setInterval(() => {
      const n = sim.simRun(SPEEDS[speedRef.current].steps)
      setSteps(s => s + n)
      const isTurbo = speedRef.current === SPEEDS.length - 1
      refresh()
      refreshOutputPorts()
      if (!isTurbo) updateMemDiff()
      if (sim.simIsHaltWaiting()) {
        setMsg('⏸ HLT — awaiting interrupt…')
        return
      }
      const r = sim.simGetRegisters()
      const atBp = bpsRef.current.has(r.pc)
      if (!sim.simIsRunning() || atBp) {
        const cond = bpsRef.current.get(r.pc)
        // Conditional BP whose condition is not met — skip and continue
        if (atBp && cond != null && !evalCondition(cond, r)) {
          sim.simStep()
          return
        }
        // Clean up one-shot breakpoints
        if (oneShotBpsRef.current.size > 0) {
          const next = new Map(bpsRef.current)
          for (const addr of oneShotBpsRef.current) next.delete(addr)
          oneShotBpsRef.current.clear()
          syncBps(next)
        }
        updateMemDiff()
        stopRun()
        setPcFlash(f => f+1)
        if (atBp) {
          setAppState('idle')
          setMsg(`⏹ Breakpoint at ${hex4(r.pc)}H`)
        } else {
          setAppState(sim.simIsHalted() ? 'halted' : 'error')
          setMsg(sim.simIsHalted() ? '■ Program halted.' : `✗ ${sim.simGetError()}`)
        }
      }
    }, 16)
  }

  function stopRun() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (appState === 'running') setAppState('idle')
  }

  function handleRun() { appState === 'running' ? stopRun() : startRun() }

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

  function openConditionDialog(addr) {
    if (!bps.has(addr)) return
    const cur = bps.get(addr) || ''
    const expr = window.prompt(
      `Condition at ${hex4(addr)}H — use A B C D E H L PC SP BC DE HL FLAGS\n(e.g.  A==0   B>10   HL>=0x200)\nLeave empty for unconditional:`,
      cur
    )
    if (expr === null) return
    const next = new Map(bps)
    next.set(addr, expr.trim() || null)
    syncBps(next)
  }

  function exportFile() {
    const blob = new Blob([srcRef.current], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'program.asm'
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  function importFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const code = ev.target.result
      srcRef.current = code; setSrc(code); doAssemble(code)
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  function shareURL() {
    const encoded = b64encode(srcRef.current)
    const base = location.href.split('#')[0]
    const url = `${base}#code=${encoded}`
    navigator.clipboard.writeText(url)
      .then(() => setMsg('✓ URL copied to clipboard!'))
      .catch(() => window.prompt('Copy this URL:', url))
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
    srcRef.current = code
    setSrc(code)
    doAssemble(code)
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

  function changeMemSize(n) {
    memSizeRef.current = n
    _setMemSize(n)
    localStorage.setItem('sim8085_memsize', n)
    doAssemble(srcRef.current)
  }

  function assertInterrupt(type, vec) {
    sim.simAssertInterrupt(type, vec)
    setIntState(sim.simGetIntState())
  }
  function deassertInterrupt(type) {
    sim.simDeassertInterrupt(type)
    setIntState(sim.simGetIntState())
  }

  const running = appState === 'running'

  return (
    <div className="app">
      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="brand">
          <BrandMenu
            onShowWelcome={() => { localStorage.removeItem('sim8085_welcomed'); setShowWelcome(true) }}
            onShowShortcuts={() => setShowShortcuts(true)}
            onImport={() => fileInputRef.current.click()}
            onExport={exportFile}
            onShare={shareURL}
            onCalc={() => setShowCalc(c => !c)}
            memSize={memSize} onMemSize={changeMemSize} />
        </div>

        <div className="toolbar">
          <ExampleMenu onLoad={loadExample} />
          <input type="file" ref={fileInputRef} style={{display:'none'}} accept=".asm,.85,.s,.txt" onChange={importFile} />
          <button className="btn btn-asm"   onClick={() => doAssemble(srcRef.current)}>⚙ Build  <kbd>F5</kbd></button>
          <button className="btn btn-step"  onClick={doStep}  disabled={running || appState==='error'}>↓ Step  <kbd>F7</kbd></button>
          <button className="btn btn-back"  onClick={doStepBack} disabled={running || appState==='error' || histLen === 0} title={`Undo last step (${histLen} available)`}>⟲ Back{histLen > 0 ? ` (${histLen})` : ''}</button>
          <button className={`btn ${running ? 'btn-stop':'btn-run'}`} onClick={handleRun}
            disabled={!running && appState==='error'}>
            {running ? '■ Stop' : '▶ Run'}  <kbd>{running?'F9':'F9'}</kbd>
          </button>
          <label className="speed-label" title={`${SPEEDS[runSpeed].steps} steps/tick`}>
            Speed
            <input type="range" min={0} max={4} value={runSpeed} className="speed-slider"
              onChange={e => { const v = +e.target.value; setRunSpeed(v); speedRef.current = v }} />
            <span className="speed-val">{SPEEDS[runSpeed].label}</span>
          </label>
          <button className="btn btn-reset" onClick={handleReset}>↺ Reset  <kbd>F6</kbd></button>
        </div>

      </div>

      {/* ── Workspace ── */}
      <div className="workspace">
        {/* Editor column */}
        <div className="col col-editor" ref={editorColRef}>
          <div className="panel editor-panel">
            <div className="panel-hd">
            <span className="panel-icon">✏️</span>EDITOR
            <div className="panel-hd-right">
              <span className="editor-hint">; semicolons for comments</span>
              <PanelHelp panel="EDITOR" />
            </div>
          </div>
            <AsmEditor value={src} onChange={v => { srcRef.current = v; setSrc(v) }} gotoRef={gotoLineRef}
              onCursorInstruction={setCursorInst}
              onInstructionDetail={setHelpInst}
              errorLine={errorLine}
              onRunTo={runToAddr}
              lineAddrRef={lineAddrRef} />
          </div>
          <HelpPanel instruction={cursorInst} />
          <LedDisplay leds={leds} />
        </div>
        <div className="col-resize-handle" onMouseDown={onEditorResizeDown} />

        {/* Code + Memory column */}
        <div className="col col-center">
          <DisasmPanel regs={regs} breakpoints={bps} onToggleBp={toggleBp} onClearAllBps={clearAllBps} buildId={buildId} pcFlash={pcFlash}
            onSetCondition={openConditionDialog}
            onRunTo={runToAddr}
            jumpRef={disasmJumpRef}
            symbols={symbols}
            onJumpMem={setMemStart}
            onGotoLine={(addr, labelName) => { const ln = addrLineMap.get(addr); if (ln) gotoLineRef.current?.(ln, labelName) }} />
          <ChatPanel regs={regs} src={src} />
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
              />
            </div>
            <div className="mem-watch-divider" onMouseDown={onMemWatchDividerDown} />
            <div className="mem-watch-watch">
              <WatchPanel watches={watches} regs={regs}
                onAdd={w => setWatches(ws => [...ws, w])}
                onRemove={i => setWatches(ws => ws.filter((_,j) => j !== i))}
                regBase={regBase} onRegBase={setRegBase} />
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
        <div className="col col-right" ref={rightColRef}>
          <RegPanel   regs={regs} prev={prevRegs} onJump={setMemStart}
            regBase={regBase} onRegBase={setRegBase} onEdit={refresh} />
          <PairPanel  regs={regs} prev={prevRegs} onJump={setMemStart} onEdit={refresh}
            regBase={regBase} onRegBase={setRegBase} />
          <FlagPanel  regs={regs} />
          <IntPanel intState={intState} onAssert={assertInterrupt} onDeassert={deassertInterrupt} />
          <IOPortPanel outputPorts={outputPorts} inputPresets={inputPresets}
            onSetInput={setInputPort} onRemoveInput={removeInputPort}
            keyQueue={keyQueue} onEnqueueKeys={enqueueKeys} onClearKeyQueue={clearKeyQueue} />
          <ConsolePanel output={consoleOutput} port={consolePort}
            onSetPort={changeConsolePort}
            onClear={() => { sim.simClearConsoleOutput(); setConsoleOutput('') }} />
          <StackPanel regs={regs} regBase={regBase} onRegBase={setRegBase} />
          <TracePanel trace={trace} onClear={() => setTrace([])} />
        </div>
      </div>
      <div className="statusbar">
        <span className="statusbar-label">LAST EVENT</span>
        <div className="statusbar-events">
          {statusLog.length === 0
            ? <span className="statusbar-empty">—</span>
            : (() => { const e = statusLog[statusLog.length - 1]; return (
              <div className={`statusbar-entry sbar-${e.kind}`}>
                <span className="statusbar-time">{e.t}</span>
                <span className="statusbar-text">{e.text}</span>
              </div>
            )})()
          }
        </div>
        {(steps > 0 || cycles > 0) && (
          <div className="statusbar-counters">
            <span className="sbar-counter" title={`${steps.toLocaleString()} instructions executed`}>{fmtCount(steps)} steps</span>
            <span className="sbar-sep">·</span>
            <span className="sbar-counter" title={`${cycles.toLocaleString()} T-states elapsed`}>{fmtCount(cycles)} T</span>
          </div>
        )}
      </div>
      {showWelcome && <WelcomeModal onClose={dismissWelcome} />}
      {helpInst && <HelpModal instruction={helpInst} onClose={() => setHelpInst(null)} />}
      {showCalc && <CalcFloat onClose={() => setShowCalc(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}
