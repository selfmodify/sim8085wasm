import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { SimulatorContext } from './SimulatorContext.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import * as sim from './simProxy.js'
import { getEngineMode, switchEngine } from './simProxy.js'
import { EXAMPLES } from './examples.js'
import { INST_HELP } from './instHelp.js'
import { useCopy, useCollapsible } from './hooks.js'
import { PanelHelp } from './PanelHelp.jsx'
import { RegPanel } from './RegPanel.jsx'
import { PairPanel } from './PairPanel.jsx'
import { FlagPanel } from './FlagPanel.jsx'
import { AsmEditor } from './AsmEditor.jsx'
import { MemPanel } from './MemPanel.jsx'
import { DisasmPanel } from './DisasmPanel.jsx'
import { CallStackPanel } from './CallStackPanel.jsx'
import { WatchPanel } from './WatchPanel.jsx'
import { StackPanel } from './StackPanel.jsx'
import { TracePanel } from './TracePanel.jsx'
import { IOPortPanel } from './IOPortPanel.jsx'
import { PPI8255Panel } from './PPI8255Panel.jsx'
import { ConsolePanel } from './ConsolePanel.jsx'
import { AudioPanel } from './AudioPanel.jsx'
import { MemMapPanel } from './MemMapPanel.jsx'
import { InterruptPanel } from './InterruptPanel.jsx'
import { LedDisplay } from './LedDisplay.jsx'
import { PIT8253Panel } from './PIT8253Panel.jsx'
import { CalcFloat } from './CalcFloat.jsx'
import { ChatPanel } from './ChatPanel.jsx'
import { PanelsMenu } from './PanelsMenu.jsx'
import { ExampleMenu } from './ExampleMenu.jsx'
import { BrandMenu } from './BrandMenu.jsx'
import { WelcomeModal } from './WelcomeModal.jsx'
import { ShortcutsModal } from './ShortcutsModal.jsx'
import { HelpModal } from './HelpModal.jsx'
import { DriveLoadModal } from './DriveLoadModal.jsx'
import { GithubSetupModal } from './GithubSetupModal.jsx'
import { UIDialog } from './UIDialog.jsx'
import { ChallengesView, CHALLENGES } from './ChallengesView.jsx'
import { CommunityView } from './CommunityView.jsx'
import { hex2, hex4, b64encode, b64decode, BASE_CYCLE, SPEEDS, fmtByte, fmtWord, TRACE_REG16, fmtTraceVal, evalCondition, fmtCount } from './utils.js'
import './App.css'

const INITIAL_PC = 0x100
const LED_COUNT = 8
const MEM_START_DEFAULT = 0x100

let _buildAddrLineMapCache = null // { code, map } — skip simDisassemble re-scan when code unchanged

function buildAddrLineMap(code) {
  if (_buildAddrLineMapCache?.code === code) return _buildAddrLineMapCache.map
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
  _buildAddrLineMapCache = { code, map }
  return map
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

const BUILD_TIME_STR = (() => {
  const d = new Date(__BUILD_TIME__)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hours = d.getHours()
  const mins = String(d.getMinutes()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${yyyy}-${mm}-${dd} ${String(h12).padStart(2, '0')}:${mins} ${ampm}`
})()

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
  const [regs, setRegs]         = useState({a:0,b:0,c:0,d:0,e:0,h:0,l:0,flags:0,pc:INITIAL_PC,sp:0,flagS:0,flagZ:0,flagAC:0,flagP:0,flagCY:0,halted:false,hasError:false})
  const [prevRegs, setPrev]     = useState(null)
  const [leds, setLeds]         = useState(Array(LED_COUNT).fill(0))
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
  const [memStart, setMemStart] = useState(MEM_START_DEFAULT)
  const [appState, setAppState] = useState('idle')  // idle | running | halted | error
  const [engineMode, setEngineMode]   = useState('js')    // 'js' | 'wasm'
  const [engineSwitching, setEngineSwitching] = useState(false)
  const engineSwitchingRef = useRef(false)
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
  const [theme, setTheme] = useState(() => localStorage.getItem('sim8085_theme') || 'dracula')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('sim8085_theme', theme)
  }, [theme])
  const [crtBrightness, setCrtBrightness] = useState(() => parseFloat(localStorage.getItem(`sim8085_crt_b_${localStorage.getItem('sim8085_theme') || 'dracula'}`) || '1'))
  const [crtContrast, setCrtContrast]     = useState(() => parseFloat(localStorage.getItem(`sim8085_crt_c_${localStorage.getItem('sim8085_theme') || 'dracula'}`) || '1'))
  const [crtGlitch, setCrtGlitch]         = useState(() => { const v = localStorage.getItem('sim8085_crt_glitch'); return v === 'true' ? 'flicker' : (v && v !== 'false' ? v : 'off') })
  const [chaosCalm, setChaosCalm]         = useState(false)
  useEffect(() => {
    setCrtBrightness(parseFloat(localStorage.getItem(`sim8085_crt_b_${theme}`) || '1'))
    setCrtContrast(parseFloat(localStorage.getItem(`sim8085_crt_c_${theme}`) || '1'))
  }, [theme])
  function toggleTheme() {
    setTheme(t =>
      t === 'dark'       ? 'dim'        :
      t === 'dim'        ? 'dracula'    :
      t === 'dracula'    ? 'light'      :
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

  const [draggedPanel, setDraggedPanel] = useState(null)
  const [dragOverPanel, setDragOverPanel] = useState(null)
  const [rightPanelOrder, setRightPanelOrder] = useState(() => {
    const defaultOrder = ['regs', 'pairs', 'flags', 'ints', 'io', 'memmap', 'audio']
    try { 
      const saved = JSON.parse(localStorage.getItem('sim8085_right_panels')) || []
      const missing = defaultOrder.filter(k => !saved.includes(k))
      return saved.concat(missing)
    }
    catch { return defaultOrder }
  })
  const [centerPanelOrder, setCenterPanelOrder] = useState(() => {
    const defaultOrder = ['stack', 'callstack', 'trace']
    try { 
      const saved = JSON.parse(localStorage.getItem('sim8085_center_panels')) || []
      const missing = defaultOrder.filter(k => !saved.includes(k))
      return saved.concat(missing)
    }
    catch { return defaultOrder }
  })

  function getDragProps(id, orderList, setOrderList, storageKey) {
    return {
      dragHandleProps: {
        draggable: true,
        title: "Drag to reorder",
        onDragStart: (e) => {
          setDraggedPanel(id)
          e.dataTransfer.effectAllowed = 'move'
          const panel = e.currentTarget.closest('.panel')
          if (panel) {
            e.dataTransfer.setDragImage(panel, 20, 20)
            setTimeout(() => { panel.style.opacity = '0.4' }, 0)
          }
        },
        onDragEnd: (e) => {
          const panel = e.currentTarget.closest('.panel')
          if (panel) panel.style.opacity = '1'
          setDraggedPanel(null)
          setDragOverPanel(null)
        }
      },
      dropTargetProps: {
        onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (draggedPanel && draggedPanel !== id && orderList.includes(draggedPanel)) setDragOverPanel(id) },
        onDragLeave: (e) => { if (dragOverPanel === id) setDragOverPanel(null) },
        onDrop: (e) => {
          e.preventDefault(); const panel = e.currentTarget.closest('.panel'); if (panel) panel.style.opacity = '1'
          setDragOverPanel(null)
          if (draggedPanel && draggedPanel !== id && orderList.includes(draggedPanel)) {
            setOrderList(prev => {
              const next = [...prev]; const from = next.indexOf(draggedPanel); const to = next.indexOf(id)
              if (from === -1 || to === -1) return prev; next.splice(from, 1); next.splice(to, 0, draggedPanel)
              localStorage.setItem(storageKey, JSON.stringify(next)); return next
            })
          }
          setDraggedPanel(null)
        }
      },
      isDragOver: dragOverPanel === id
    }
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

  function lsSet(key, val) { try { localStorage.setItem(key, val) } catch (e) { if (import.meta.env.DEV) console.warn('localStorage write failed:', e) } }
  useEffect(() => { lsSet('sim8085_bps', JSON.stringify([...bps.entries()])) }, [bps])
  useEffect(() => { lsSet('sim8085_databps', JSON.stringify([...dataBps])) }, [dataBps])
  useEffect(() => { lsSet('sim8085_watches', JSON.stringify(watches)) }, [watches])
  useEffect(() => { lsSet('sim8085_io_presets', JSON.stringify(inputPresets)) }, [inputPresets])

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
      // callStackRef mirrors state so doStepOver/doStepOut can read it synchronously mid-loop
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
    setAppDialog({
      type: 'confirm',
      title: 'New File',
      message: 'This will completely clear the editor, wipe all RAM to 00H, and remove all watches, I/O presets, and breakpoints. Proceed?',
      confirmText: 'Yes, clear everything',
      onConfirm: () => {
        const blank = '; New 8085 program\n\tORG 0000H\n\nSTART:\n\n\tHLT\n'
        srcRef.current = blank
        setSrc(blank)
        setFileName('untitled.asm')
        localStorage.removeItem('sim8085_filename')
        
        sim.simClearAllBreakpoints()
        if (sim.simClearAllDataBreakpoints) sim.simClearAllDataBreakpoints()
        setBps(new Map())
        bpsRef.current = new Map()
        setDataBps(new Set())
        setWatches([])
        setInputPresets([])
        
        doAssemble(blank)
        setMsg('✓ Created new file (clean slate)')
      }
    })
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
    if (mode === engineMode || engineSwitchingRef.current) return
    engineSwitchingRef.current = true
    stopRun()
    setEngineSwitching(true)
    setMsg(`Switching to ${mode.toUpperCase()} engine…`)
    try {
      const result = await switchEngine(mode)
      if (!result.ok) {
        setMsg(`✗ WASM unavailable: ${result.error}`)
        setEngineMode('js')
        return
      }
      setEngineMode(mode)
      sim.simInit()
      doAssemble(srcRef.current)
    } finally {
      engineSwitchingRef.current = false
      setEngineSwitching(false)
    }
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

  function loadSolution(c) {
    const code = `; Solution: ${c.title}\n; ${c.desc}\n\n${c.setup ? c.setup + '\n\n' : ''}    org 100H\n    kickoff 100H\n\n; ── SOLUTION STARTS HERE ────────────────────────────\n${c.solution}\n; ── SOLUTION ENDS HERE ──────────────────────────────\n\n    hlt\n`
    srcRef.current = code
    setSrc(code)
    doAssemble(code)
    setFileName(c.title + ' - Solution.asm')
    localStorage.setItem('sim8085_filename', c.title + ' - Solution.asm')
    setChallengeResult(null)
    setActiveChallenge(c)
    setActiveView('simulator')
  }

  function onBrewCoffee() {
    const base = "       ###\n      #####\n       ###\n     =======\n    |       |\\\n    |       | |\n     \\_____/ /\n      ======";
    setAppDialog({
      type: 'alert',
      title: 'Virtual Coffee',
      message: "Initializing brewing sequence...\n\n      ) )\n     ( (\n" + base,
      frames: [
        "Initializing brewing sequence...\n\n      ) )\n     ( (\n" + base,
        "Initializing brewing sequence...\n\n     ( (\n      ) )\n" + base,
        "Initializing brewing sequence...\n\n       ) )\n      ( (\n" + base,
        "Initializing brewing sequence...\n\n      ( (\n       ) )\n" + base,
        "Initializing brewing sequence...\n\n       ( (\n      ) )\n" + base,
        "Initializing brewing sequence...\n\n      ) )\n     ( (\n" + base
      ],
      animationSpeed: 300,
      confirmText: 'Buy me a real coffee ☕',
      onConfirm: () => window.open('https://ko-fi.com/sim8085', '_blank')
    })
  }

  useEffect(() => {
    const isRetro = ['amber-mono', 'gray-crt', 'green', 'turbo-c', 'cp437'].includes(theme)
    if (!isRetro || crtGlitch !== 'chaos') { setChaosCalm(false); return }
    let id
    const tick = (calm) => { id = setTimeout(() => { setChaosCalm(!calm); tick(!calm) }, calm ? 1000 : 4000) }
    setChaosCalm(false)
    tick(false)
    return () => clearTimeout(id)
  }, [theme, crtGlitch])

  const running = appState === 'running'
  const isDirty = src !== lastBuiltSrcRef.current
  const isRetroTheme = ['amber-mono', 'gray-crt', 'green', 'turbo-c', 'cp437'].includes(theme)

  const simCtxValue = useMemo(
    () => ({ regBase, onRegBase: setRegBase, onEdit: refresh, onShowDialog: setAppDialog }),
    [regBase] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <SimulatorContext.Provider value={simCtxValue}>
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
            activeView={activeView} onSetView={setActiveView}
            onBrewCoffee={onBrewCoffee} />
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
        <span className="build-chip" title="Build timestamp">Build: {BUILD_TIME_STR}</span>
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
                  {centerPanelOrder.map(key => {
                    if (!panels[key]) return null;
                    const dp = getDragProps(key, centerPanelOrder, setCenterPanelOrder, 'sim8085_center_panels')
                    if (key === 'stack') return <ErrorBoundary key={key}><StackPanel regs={regs} {...dp} /></ErrorBoundary>
                    if (key === 'callstack') return <ErrorBoundary key={key}><CallStackPanel callStack={callStack} onJump={setMemStart} {...dp} /></ErrorBoundary>
                    if (key === 'trace') return <ErrorBoundary key={key}><TracePanel trace={trace} onClear={() => setTrace([])} {...dp} /></ErrorBoundary>
                    return null
                  })}
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
          {rightPanelOrder.map(key => {
            if (!panels[key]) return null;
            const dp = getDragProps(key, rightPanelOrder, setRightPanelOrder, 'sim8085_right_panels')
            if (key === 'regs')   return <ErrorBoundary key={key}><RegPanel regs={regs} prev={prevRegs} onJump={setMemStart} {...dp} /></ErrorBoundary>
            if (key === 'pairs')  return <ErrorBoundary key={key}><PairPanel regs={regs} prev={prevRegs} onJump={setMemStart} onMemoryEdited={() => setBuildId(id => id + 1)} {...dp} /></ErrorBoundary>
            if (key === 'flags')  return <ErrorBoundary key={key}><FlagPanel regs={regs} {...dp} /></ErrorBoundary>
            if (key === 'ints')   return <ErrorBoundary key={key}><InterruptPanel intState={intState} onAssert={assertInterrupt} onDeassert={deassertInterrupt} {...dp} /></ErrorBoundary>
            if (key === 'io')     return <ErrorBoundary key={key}><IOPortPanel outputPorts={outputPorts} inputPresets={inputPresets} onSetInput={setInputPort} onRemoveInput={removeInputPort} keyQueue={keyQueue} onEnqueueKeys={enqueueKeys} onClearKeyQueue={clearKeyQueue} sid={sid} sod={sod} onSetSID={v => { sim.simSetSID(v); setSid(v); }} {...dp} /></ErrorBoundary>
            if (key === 'memmap') return <ErrorBoundary key={key}><MemMapPanel regs={regs} programRegion={programRegion} presetAddrs={presetAddrs} {...dp} /></ErrorBoundary>
            if (key === 'audio')  return <ErrorBoundary key={key}><AudioPanel outputPorts={outputPorts} running={running} onShowDialog={setAppDialog} {...dp} /></ErrorBoundary>
            return null
          })}
        </div>
      </div>
      </div>

      {activeView === 'challenges' && (
        <ChallengesView onSelect={loadChallenge} onSolution={loadSolution} />
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
      {showWelcome && <WelcomeModal onClose={dismissWelcome} onBrewCoffee={onBrewCoffee} />}
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
    </SimulatorContext.Provider>
  )
}
