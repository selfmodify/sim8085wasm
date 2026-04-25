import { useState, useEffect, useRef, useMemo } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import * as sim from './sim8085Bridge.js'
import './App.css'

// ── Example programs ────────────────────────────────────────────────────
const EXAMPLES = {
  'Counter': `; Simple A register counter
    org 100
    kickoff 100
    mvi a,0
    mvi b,0
loop:
    inr a
    inr b
    jnz loop
    hlt`,

  'Bubble Sort': `; Bubble sort — sorts 10 values
    setbyte 251,34
    setbyte 252,30
    setbyte 253,26
    setbyte 254,23
    setbyte 255,20
    setbyte 256,17
    setbyte 257,14
    setbyte 258,10
    setbyte 259,7
    setbyte 25a,3

    org 100
    kickoff 100
    mvi  b,9
loop2: lxi  h,251
    mov  c,b
loop1: mov  a,m
    inx  h
    cmp  m
    jc   next
    mov  d,m
    mov  m,a
    dcx  h
    mov  m,d
    inx  h
next: dcr  c
    jnz  loop1
    dcr  b
    jnz  loop2
    hlt`,

  'Fibonacci': `; Fibonacci sequence stored from 200H
    org 100
    kickoff 100
    lxi h,200
    mvi a,0
    mov m,a
    inx h
    mvi a,1
    mov m,a
    inx h
    mvi b,0eH
fib:
    dcx h
    mov a,m
    inx h
    add m
    inx h
    mov m,a
    dcr b
    jnz fib
    hlt`,

  'LED Scroll': `; Scroll the LED display (watch the LED panel!)
    org 100
    kickoff 100
    setbyte 511,0
    setbyte 512,1
    setbyte 513,2
    setbyte 514,3
    setbyte 515,4
    setbyte 516,5
    setbyte 517,6
    setbyte 518,7
    lxi sp,200
again:
    lxi h,511
    mvi b,8
loop:
    mvi  c,0bH
    mov d,m
    call 5
    mvi a,9
    push h
    lxi h,55H
    call 5
    pop h
    inx h
    dcr b
    jnz loop
    jmp again
    hlt`,

  'Checksum': `; Compute XOR checksum of memory block
    org 100
    kickoff 100
    setbyte 200,0aH
    setbyte 201,1bH
    setbyte 202,2cH
    setbyte 203,3dH
    setbyte 204,4eH
    lxi h,200
    mvi b,5
    mvi a,0
xloop:
    xra m
    inx h
    dcr b
    jnz xloop
    sta 300
    hlt`,
}

// ── Helpers ─────────────────────────────────────────────────────────────
const hex2 = n => (n >>> 0 & 0xFF).toString(16).toUpperCase().padStart(2,'0')
const hex4 = n => (n >>> 0 & 0xFFFF).toString(16).toUpperCase().padStart(4,'0')

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
    <svg width="22" height="32" viewBox="0 0 17 23">
      {segs.map(s => <path key={s.id} d={s.d} fill={value & s.bit ? ON : OFF} />)}
    </svg>
  )
}

// ── CodeMirror editor ────────────────────────────────────────────────────
function AsmEditor({ value, onChange }) {
  const elRef  = useRef(null)
  const viewRef = useRef(null)
  const syncing = useRef(false)

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          lineNumbers(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          oneDark,
          EditorView.theme({
            '&': { height:'100%', fontFamily:'"JetBrains Mono","Fira Code",monospace', fontSize:'13px' },
            '.cm-scroller': { overflow:'auto' },
            '.cm-content': { padding:'8px 0', minHeight:'100%' },
          }),
          EditorView.updateListener.of(u => {
            if (u.docChanged && !syncing.current) onChange(u.state.doc.toString())
          }),
        ],
      }),
      parent: elRef.current,
    })
    viewRef.current = view
    return () => view.destroy()
  }, [])

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

  return <div ref={elRef} className="editor-inner" />
}

// ── Register panel ───────────────────────────────────────────────────────
function RegPanel({ regs, prev }) {
  function Row({ name, val, prevVal }) {
    return (
      <div className={`reg-row${prevVal !== undefined && val !== prevVal ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{hex2(val)}</span>
        <span className="reg-dec">{val}</span>
      </div>
    )
  }
  function Row16({ name, val, prevVal }) {
    return (
      <div className={`reg-row wide${prevVal !== undefined && val !== prevVal ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{hex4(val)}</span>
        <span className="reg-dec">{val}</span>
      </div>
    )
  }
  const p = prev || {}
  return (
    <div className="panel reg-panel">
      <div className="panel-hd">REGISTERS</div>
      <Row name="A"  val={regs.a}  prevVal={p.a} />
      <Row name="B"  val={regs.b}  prevVal={p.b} />
      <Row name="C"  val={regs.c}  prevVal={p.c} />
      <Row name="D"  val={regs.d}  prevVal={p.d} />
      <Row name="E"  val={regs.e}  prevVal={p.e} />
      <Row name="H"  val={regs.h}  prevVal={p.h} />
      <Row name="L"  val={regs.l}  prevVal={p.l} />
      <div className="reg-sep" />
      <Row16 name="PC" val={regs.pc} prevVal={p.pc} />
      <Row16 name="SP" val={regs.sp} prevVal={p.sp} />
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
      <div className="panel-hd">FLAGS</div>
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
function DisasmPanel({ regs, breakpoints, onToggleBp }) {
  const lines = useMemo(() => {
    const out = []
    let addr = Math.max(0, regs.pc - 6)
    for (let i = 0; i < 20 && addr < 0x4000; i++) {
      const d = sim.simDisassemble(addr)
      out.push({ addr, ...d })
      addr += Math.max(1, d.len)
    }
    return out
  }, [regs.pc])

  return (
    <div className="panel disasm-panel">
      <div className="panel-hd">DISASSEMBLY</div>
      <div className="disasm-list">
        {lines.map(row => {
          const cur = row.addr === regs.pc
          const bp  = breakpoints.has(row.addr)
          return (
            <div
              key={row.addr}
              className={`disasm-row${cur ? ' cur' : ''}${bp ? ' bp' : ''}`}
              onClick={() => onToggleBp(row.addr)}
              title="Click to toggle breakpoint"
            >
              <span className="disasm-bp">{bp ? '●' : '·'}</span>
              <span className="disasm-text">{row.text}</span>
              {cur && <span className="disasm-pc-arrow">◀</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Memory dump panel ────────────────────────────────────────────────────
function MemPanel({ memStart, onJump, regs }) {
  const [mem, setMem] = useState(new Uint8Array(128))
  const [editing, setEditing] = useState(null)
  const [editBuf, setEditBuf] = useState('')
  const [rows, setRows] = useState(8)
  const COLS = 16
  const scrollRef = useRef(null)
  const panelRef  = useRef(null)

  useEffect(() => {
    if (!scrollRef.current) return
    const ro = new ResizeObserver(([e]) => {
      setRows(r => { const n = Math.max(2, Math.floor((e.contentRect.height - 20) / 17)); return n !== r ? n : r })
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
  useEffect(refresh, [memStart, regs.pc, rows])

  function commit(addr, raw) {
    const v = parseInt(raw, 16)
    if (!isNaN(v)) sim.simWriteByte(addr, v)
    setEditing(null)
    refresh()
  }

  return (
    <div className="panel mem-panel" ref={panelRef}>
      <div className="mem-resize-handle" onMouseDown={onHandleMouseDown} />
      <div className="panel-hd">
        MEMORY
        <span className="mem-ctrl">
          <button className="mem-btn" onClick={() => onJump(Math.max(0, memStart - COLS*rows))}>◀</button>
          <code className="mem-cur-addr">{hex4(memStart)}</code>
          <button className="mem-btn" onClick={() => onJump(Math.min(0x3F00, memStart + COLS*rows))}>▶</button>
        </span>
      </div>
      <div className="mem-scroll" ref={scrollRef}>
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
                    const isPC = addr === regs.pc
                    const isSP = addr === regs.sp
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
                        className={`mem-cell${isPC?' mem-pc':''}${isSP?' mem-sp':''}${val?' mem-nz':''}`}
                        title={`${hex4(addr)}: ${hex2(val)}H = ${val}`}
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
        <span className="legend-tip">double-click to edit</span>
      </div>
    </div>
  )
}

// ── Stack panel ──────────────────────────────────────────────────────────
function StackPanel({ regs }) {
  const entries = useMemo(() => {
    const out = []
    for (let i = 0; i < 6; i++) {
      const a = (regs.sp + i*2) & 0xFFFF
      if (a >= 0x4000) break
      out.push({ addr: a, val: sim.simReadByte(a) | (sim.simReadByte(a+1)<<8) })
    }
    return out
  }, [regs.sp])

  return (
    <div className="panel stack-panel">
      <div className="panel-hd">STACK  <code className="sp-val">SP={hex4(regs.sp)}</code></div>
      {entries.length === 0
        ? <div className="stack-empty">empty</div>
        : entries.map((e,i) => (
          <div key={e.addr} className={`stack-row${i===0?' stack-top':''}`}>
            <span className="stack-addr">{hex4(e.addr)}</span>
            <span className="stack-sep">→</span>
            <span className="stack-val">{hex4(e.val)}</span>
          </div>
        ))
      }
    </div>
  )
}

// ── LED display ──────────────────────────────────────────────────────────
function LedDisplay({ leds }) {
  const LABELS = ['ST₁','ST₀','A₃','A₂','A₁','A₀','D₁','D₀']
  return (
    <div className="panel led-panel">
      <div className="panel-hd">LED DISPLAY</div>
      <div className="led-digits">
        {leds.map((v,i) => (
          <div key={i} className="led-digit">
            <SevenSeg value={v} />
            <div className="led-lbl">{LABELS[i]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Root app ─────────────────────────────────────────────────────────────
export default function App() {
  const [src, setSrc]           = useState(EXAMPLES['Counter'])
  const [regs, setRegs]         = useState({a:0,b:0,c:0,d:0,e:0,h:0,l:0,flags:0,pc:0x100,sp:0,flagS:0,flagZ:0,flagAC:0,flagP:0,flagCY:0,halted:false,hasError:false})
  const [prevRegs, setPrev]     = useState(null)
  const [leds, setLeds]         = useState(Array(8).fill(0))
  const [bps, setBps]           = useState(new Set())
  const [memStart, setMemStart] = useState(0x100)
  const [appState, setAppState] = useState('idle')  // idle | running | halted | error
  const [msg, setMsg]           = useState('Load an example or write code, then click Assemble.')
  const [steps, setSteps]       = useState(0)
  const timerRef = useRef(null)

  useEffect(() => { sim.simInit(); doAssemble(src); }, [])

  function refresh() {
    const r = sim.simGetRegisters()
    setRegs(old => { setPrev(old); return r })
    setLeds(sim.simGetAllLeds())
  }

  function doAssemble(code) {
    stopRun()
    sim.simInit()
    const res = sim.simAssemble(code)
    setSteps(0)
    if (!res.ok) {
      setAppState('error')
      setMsg(`✗ ${res.errorMsg}`)
    } else {
      setAppState('idle')
      setMsg(`✓ ${res.bytesEmitted} bytes assembled at ${hex4(res.entryPoint)}H — ready.`)
      refresh()
    }
  }

  function doStep() {
    stopRun()
    const ok = sim.simStep()
    setSteps(s => s+1)
    refresh()
    if (!ok) {
      setAppState(sim.simIsHalted() ? 'halted' : 'error')
      setMsg(sim.simIsHalted() ? '■ Program halted.' : `✗ ${sim.simGetError()}`)
    }
  }

  function startRun() {
    if (timerRef.current) return
    setAppState('running')
    setMsg('▶ Running…')
    timerRef.current = setInterval(() => {
      const n = sim.simRun(1000)
      setSteps(s => s + n)
      refresh()
      if (!sim.simIsRunning()) {
        stopRun()
        setAppState(sim.simIsHalted() ? 'halted' : 'error')
        setMsg(sim.simIsHalted() ? '■ Program halted.' : `✗ ${sim.simGetError()}`)
      }
    }, 16)
  }

  function stopRun() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (appState === 'running') setAppState('idle')
  }

  function handleRun() { appState === 'running' ? stopRun() : startRun() }

  function handleReset() { doAssemble(src) }

  function toggleBp(addr) {
    sim.simSetBreakpoint(addr)
    setBps(new Set(sim.simGetBreakpoints()))
  }

  function loadExample(name) {
    const code = EXAMPLES[name]
    setSrc(code)
    doAssemble(code)
  }

  const running = appState === 'running'

  return (
    <div className="app">
      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-chip">8085</div>
          <div className="brand-text">
            <span className="brand-title">Simulator</span>
            <span className="brand-sub">original by V. Kumar · 1997 · ported to web</span>
          </div>
        </div>

        <div className="toolbar">
          <select className="ex-select" defaultValue="" onChange={e => { if(e.target.value) loadExample(e.target.value) }}>
            <option value="" disabled>Load example…</option>
            {Object.keys(EXAMPLES).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="btn btn-asm"   onClick={()=>doAssemble(src)}>⚙ Build  <kbd>F5</kbd></button>
          <button className="btn btn-step"  onClick={doStep}  disabled={running}>↓ Step  <kbd>F7</kbd></button>
          <button className={`btn ${running ? 'btn-stop':'btn-run'}`} onClick={handleRun}>
            {running ? '■ Stop' : '▶ Run'}  <kbd>{running?'F9':'F9'}</kbd>
          </button>
          <button className="btn btn-reset" onClick={handleReset}>↺ Reset  <kbd>F6</kbd></button>
        </div>

        <div className={`status status-${appState}`}>
          <span className="status-msg">{msg}</span>
          {steps > 0 && <span className="status-steps">{steps.toLocaleString()} steps</span>}
        </div>
      </div>

      {/* ── Workspace ── */}
      <div className="workspace">
        {/* Editor column */}
        <div className="col col-editor">
          <div className="panel editor-panel">
            <div className="panel-hd">EDITOR  <span className="editor-hint">; semicolons for comments</span></div>
            <AsmEditor value={src} onChange={v => setSrc(v)} />
          </div>
          <LedDisplay leds={leds} />
        </div>

        {/* Code + Memory column */}
        <div className="col col-center">
          <DisasmPanel regs={regs} breakpoints={bps} onToggleBp={toggleBp} />
          <MemPanel
            memStart={memStart}
            onJump={setMemStart}
            regs={regs}
          />
          <div className="jump-row">
            <button className="btn btn-xs" onClick={()=>setMemStart(regs.pc & 0xFFF0)}>→ PC</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(regs.sp & 0xFFF0)}>→ SP</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(0x100)}>→ 100H</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(0x200)}>→ 200H</button>
          </div>
        </div>

        {/* Registers column */}
        <div className="col col-right">
          <RegPanel   regs={regs} prev={prevRegs} />
          <FlagPanel  regs={regs} />
          <StackPanel regs={regs} />
        </div>
      </div>
    </div>
  )
}
