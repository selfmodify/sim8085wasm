import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { SimulatorContext } from './SimulatorContext.jsx'
import * as sim from './simProxy.js'
import { getEngineMode, switchEngine } from './simProxy.js'
import { EXAMPLES } from './examples.js'
import { INST_HELP } from './instHelp.js'
import { useCopy, useCollapsible } from './hooks.js'
import { PPI8255Panel } from './PPI8255Panel.jsx'
import { PIT8253Panel } from './PIT8253Panel.jsx'
import { CalcFloat } from './CalcFloat.jsx'
import { ChatPanel } from './ChatPanel.jsx'
import { Toolbar } from './Toolbar.jsx'
import { BrandMenu } from './BrandMenu.jsx'
import { HelpPanel } from './HelpPanel.jsx'
import { WelcomeModal } from './WelcomeModal.jsx'
import { ShortcutsModal } from './ShortcutsModal.jsx'
import { HelpModal } from './HelpModal.jsx'
import { DriveLoadModal } from './DriveLoadModal.jsx'
import { GithubSetupModal } from './GithubSetupModal.jsx'
import { UIDialog } from './UIDialog.jsx'
import { ChallengesView, CHALLENGES } from './ChallengesView.jsx'
import { CommunityView } from './CommunityView.jsx'
import { useSimulatorEngine } from './useSimulatorEngine.js'
import { useGoogleDrive } from './useGoogleDrive.js'
import { PopoutWindow } from './PopoutWindow.jsx'
import { BreadboardView } from './BreadboardView.jsx'
import { PanelWorkspace } from './PanelWorkspace.jsx'
import { hex2, hex4, b64encode, b64decode, BASE_CYCLE, SPEEDS, fmtByte, fmtWord, TRACE_REG16, fmtTraceVal, evalCondition, fmtCount, RETRO_THEMES } from './utils.js'
import './App.css'

const INITIAL_PC = 0x100
const LED_COUNT = 8
const MEM_START_DEFAULT = 0x100

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
  
  const [readOnlySource, setReadOnlySource] = useState(() => {
    try {
      const hash = location.hash
      if (hash.startsWith('#example=')) return 'Example'
      if (hash.startsWith('#gist=')) return 'GitHub Gist'
    } catch {}
    return localStorage.getItem('sim8085_readonly') || null
  })

  const srcRef = useRef(src)
  const [helpInst, setHelpInst]     = useState(null)
  
  const engine = useSimulatorEngine(srcRef)
  
  const [mobileTab,      setMobileTab]      = useState('editor')
  const [activeView,     setActiveView]     = useState('simulator') // 'simulator' | 'challenges'
  const [theme, setTheme] = useState(() => localStorage.getItem('sim8085_theme') || 'dracula')
  const [breadboardPoppedOut, setBreadboardPoppedOut] = useState(false)

  function handleSetView(v) {
    setActiveView(v)
    if (v === 'breadboard') {
      setPanels(p => {
        if (!p.ppi || !p.pit) {
          const next = { ...p, ppi: true, pit: true };
          localStorage.setItem('sim8085_panels', JSON.stringify(next));
          return next;
        }
        return p;
      });
    }
  }
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('sim8085_theme', theme)
  }, [theme])
  
  const [crtBrightness, setCrtBrightness] = useState(() => parseFloat(localStorage.getItem(`sim8085_crt_b_${localStorage.getItem('sim8085_theme') || 'dracula'}`) || '1'))
  const [crtContrast, setCrtContrast]     = useState(() => parseFloat(localStorage.getItem(`sim8085_crt_c_${localStorage.getItem('sim8085_theme') || 'dracula'}`) || '1'))
  const [crtGlitch, setCrtGlitch]         = useState(() => { const v = localStorage.getItem('sim8085_crt_glitch'); return v === 'true' ? 'flicker' : (v && v !== 'false' ? v : 'off') })
  const [crtVignette, setCrtVignette]     = useState(() => localStorage.getItem('sim8085_crt_vignette') !== 'false')
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
      t === 'gray-crt'   ? 'green'      :
      t === 'green'      ? 'blue-crt'   :
      t === 'blue-crt'   ? 'plasma'     : 'dark'
    )
  }

  const [activeChallenge, setActiveChallenge] = useState(null)
  const [challengeResult, setChallengeResult] = useState(null)
  const [appDialog, setAppDialog]             = useState(null)
  const [showGithubSetup, setShowGithubSetup] = useState(false)

  const {
    driveFiles, setDriveFiles, driveToken, driveLoading, driveSaveStatus,
    connectDrive, handleDriveDisconnect, saveToDrive, saveAsToDrive,
    loadFromDrive, fetchDriveFile, deleteDriveFile
  } = useGoogleDrive({ engine, srcRef, setSrc, fileName, setFileName, setActiveChallenge, setAppDialog })

  const lastHaltRef                           = useRef(0)
  
  const [panels, setPanels] = useState(() => {
    const def = { regs:true, pairs:true, flags:true, ints:true, io:true, memmap:false, ppi:true, pit:false, audio:true, stack:true, callstack:true, trace:true }
    try { return { ...def, ...JSON.parse(localStorage.getItem('sim8085_panels')) } } catch { return def }
  })
  
  const [ppiPos, setPpiPos] = useState(() => {
    try { const p = JSON.parse(localStorage.getItem('sim8085_ppi_pos')); if (p && typeof p.x === 'number') return p; } catch {}
    return { x: Math.max(0, Math.round((window.innerWidth / 2 + 50) / 20) * 20), y: 100 }
  })
  const [pitPos, setPitPos] = useState(() => {
    try { const p = JSON.parse(localStorage.getItem('sim8085_pit_pos')); if (p && typeof p.x === 'number') return p; } catch {}
    return { x: Math.max(0, Math.round((window.innerWidth / 2 - 350) / 20) * 20), y: 100 }
  })
  const [ledPos, setLedPos] = useState(() => {
    try { const p = JSON.parse(localStorage.getItem('sim8085_led_pos')); if (p && typeof p.x === 'number') return p; } catch {}
    return { x: Math.max(0, Math.round((window.innerWidth / 2 - 150) / 20) * 20), y: 360 }
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
  
  function dismissWelcome() { localStorage.setItem('sim8085_welcomed', '1'); setShowWelcome(true) }
  
  const [runSpeed, setRunSpeed]     = useState(() => {
    const s = parseInt(localStorage.getItem('sim8085_speed'), 10)
    return s >= 0 && s < SPEEDS.length ? s : 3
  })
  
  const [regBase, setRegBase]       = useState('hex')    // 'hex'|'dec'|'bin'
  const [statusLog, setStatusLog]   = useState([])
  
  const fileInputRef   = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem('sim8085_program', src) } catch {} }, 1000)
    return () => clearTimeout(t)
  }, [src])

  useEffect(() => {
    sim.simInit()
    const hash = window.location.hash
    if (hash.startsWith('#gist=')) {
      loadFromGist(hash.slice(6))
      window.history.replaceState(null, '', window.location.pathname)
    } else {
      engine.doAssemble(src)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hotkeysRef = useRef(null)
  useEffect(() => { hotkeysRef.current = { handleBuild, handleReset, doStep: engine.doStep, doStepOver: engine.doStepOver, doStepOut: engine.doStepOut, handleRun: engine.handleRun, running: engine.running, appState: engine.appState } })
  useEffect(() => {
    function onKey(e) {
      const h = hotkeysRef.current
      if (e.key === 'F5') { e.preventDefault(); h.handleBuild() }
      if (e.key === 'F6') { e.preventDefault(); if (!h.running) h.handleReset() }
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
    if (engine.msg === 'Load an example or write code, then click Build.') return
    const t = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})
    const kind = engine.msg.startsWith('✗') || engine.msg.startsWith('❌') ? 'error' : engine.msg.startsWith('✓') || engine.msg.startsWith('🏆') ? 'success' : engine.msg.startsWith('■') ? 'halted' : 'info'
    setStatusLog(log => [...log.slice(-19), { text: engine.msg, kind, t }])
  }, [engine.msg])

  useEffect(() => {
    if (engine.haltTrigger > lastHaltRef.current && activeChallenge && !challengeResult) {
      lastHaltRef.current = engine.haltTrigger
      if (activeChallenge.test()) {
        setChallengeResult({ passed: true, msg: activeChallenge.successMsg })
        engine.setMsg(`🏆 Challenge Passed: ${activeChallenge.successMsg}`)
      } else {
        setChallengeResult({ passed: false, msg: 'Memory output does not match expected result. Check your logic and try again!' })
        engine.setMsg(`❌ Challenge Failed: Output is incorrect. Keep trying!`)
      }
    }
  }, [engine.haltTrigger, activeChallenge, challengeResult])

  function lsSet(key, val) { try { localStorage.setItem(key, val) } catch (e) { if (import.meta.env.DEV) console.warn('localStorage write failed:', e) } }
  useEffect(() => { lsSet('sim8085_bps', JSON.stringify([...engine.bps.entries()])) }, [engine.bps])
  useEffect(() => { lsSet('sim8085_databps', JSON.stringify([...engine.dataBps])) }, [engine.dataBps])
  useEffect(() => { lsSet('sim8085_watches', JSON.stringify(engine.watches)) }, [engine.watches])
  useEffect(() => { lsSet('sim8085_io_presets', JSON.stringify(engine.inputPresets)) }, [engine.inputPresets])
  useEffect(() => { lsSet('sim8085_ppi_pos', JSON.stringify(ppiPos)) }, [ppiPos])
  useEffect(() => { lsSet('sim8085_pit_pos', JSON.stringify(pitPos)) }, [pitPos])
  useEffect(() => { lsSet('sim8085_led_pos', JSON.stringify(ledPos)) }, [ledPos])
  useEffect(() => { lsSet('sim8085_readonly', readOnlySource || '') }, [readOnlySource])
  
  function handleBuild() {
    if (engine.running) {
      setAppDialog({
        type: 'confirm',
        title: 'Simulator Running',
        message: 'The simulator is currently running. Building will stop execution and reset the CPU state. Proceed?',
        confirmText: 'Yes, build',
        onConfirm: () => engine.doAssemble(srcRef.current)
      })
    } else {
      engine.doAssemble(srcRef.current)
    }
  }

  function confirmLoad(action, onCancel) {
    if (engine.running) {
      setAppDialog({
        type: 'confirm',
        title: 'Simulator Running',
        message: 'The simulator is currently running. Loading new code will stop execution and reset the CPU state. Proceed?',
        confirmText: 'Yes, load',
        onConfirm: () => { if (engine.running) engine.handleRun(); action() },
        onCancel: onCancel
      })
    } else {
      action()
    }
  }

  function handleReset() { if (!engine.running) engine.doAssemble(srcRef.current) }
  
  function openConditionDialog(addr) {
    if (!engine.bps.has(addr)) return
    const cur = engine.bps.get(addr) || ''
    setAppDialog({
      type: 'prompt',
      title: `Condition at ${hex4(addr)}H`,
      message: 'Use A B C D E H L PC SP BC DE HL FLAGS S Z AC P CY\n(e.g.  A==0   CY==1   HL>=0x200)\nLeave empty for unconditional:',
      defaultValue: cur,
      onConfirm: (expr) => {
        if (expr === undefined) return
        const next = new Map(engine.bps)
        next.set(addr, expr.trim() || null)
        engine.syncBps(next)
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
    if (engine.running) engine.handleRun()
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
    if (engine.running) engine.handleRun()
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

  async function loadFromGist(presetId) {
    const load = async (input) => {
      const match = input.match(/[0-9a-f]{20,}/i) || input.match(/^[a-zA-Z0-9_-]+$/)
      const gistId = match ? match[0] : input.trim()
      if (!gistId) return
      setActiveChallenge(null)
      engine.setMsg('Fetching GitHub Gist…')
      try {
        const res = await fetch(`https://api.github.com/gists/${gistId}`)
        if (!res.ok) throw new Error('Gist not found or private')
        const data = await res.json()
        const file = Object.values(data.files).find(f => f.filename.endsWith('.asm') || f.filename.endsWith('.85')) || Object.values(data.files)[0]
        if (!file) throw new Error('No valid files found in Gist')
        srcRef.current = file.content; setSrc(file.content); engine.doAssemble(file.content)
        setFileName(file.filename); localStorage.setItem('sim8085_filename', file.filename)
        engine.setMsg(`✓ Loaded ${file.filename} from GitHub Gist`)
        setReadOnlySource('GitHub Gist')
        handleSetView('simulator')
      } catch(e) { engine.setMsg(`✗ Error loading GitHub Gist: ${e.message}`) }
    }

    if (typeof presetId === 'string') {
      confirmLoad(() => load(presetId))
    } else {
      setAppDialog({
        type: 'prompt',
        title: 'Load Gist',
        message: 'Enter a GitHub Gist ID or URL:',
        onConfirm: (input) => { if (input) confirmLoad(() => load(input)) }
      })
    }
  }

  async function saveToGist() {
    let token = localStorage.getItem('sim8085_github_token')
    if (!token) {
      setShowGithubSetup(true)
      return
    }
    engine.setMsg('Saving to GitHub Gist…')
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
      engine.setMsg(`✓ Saved to GitHub Gist! URL copied to clipboard.`)
    } catch(e) { engine.setMsg(`✗ Error saving GitHub Gist: ${e.message}`) }
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
        
        engine.syncBps(new Map())
        engine.clearAllDataBps()
        engine.setWatches([])
        engine.setInputPresets([])
        
        engine.doAssemble(blank)
        setReadOnlySource(null)
        engine.setMsg('✓ Created new file (clean slate)')
      }
    })
  }

  function importFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const target = e.target

    const doImport = () => {
      setActiveChallenge(null)
      const ext = file.name.split('.').pop().toLowerCase()

      if (ext === 'hex') {
        const reader = new FileReader()
        reader.onload = ev => {
          try {
            const bytes = parseIntelHex(ev.target.result)
            sim.simInit()
            for (const [addr, val] of bytes) sim.simWriteByte(addr, val)
            engine.setMsg(`✓ Loaded ${bytes.size} bytes from ${file.name}`)
            engine.setAppState('idle'); engine.setBuildId(id => id + 1)
            setFileName(file.name); localStorage.setItem('sim8085_filename', file.name)
          } catch(err) { engine.setMsg(`✗ HEX parse error: ${err.message}`) }
          target.value = ''
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
            if (!inputAddr) { target.value = ''; return }
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
              engine.setMsg(`✓ Loaded ${bytes.length} bytes from ${file.name} at ${hex4(startAddr)}H`)
              engine.setAppState('idle'); engine.setBuildId(id => id + 1)
              setFileName(file.name); localStorage.setItem('sim8085_filename', file.name)
              target.value = ''
            }
            reader.readAsArrayBuffer(file)
          },
          onCancel: () => { target.value = '' }
        })
        return
      }

      const reader = new FileReader()
      reader.onload = ev => {
        const code = ev.target.result
        srcRef.current = code; setSrc(code); engine.doAssemble(code)
        setFileName(file.name); localStorage.setItem('sim8085_filename', file.name)
      setReadOnlySource(null)
        target.value = ''
      }
      reader.readAsText(file)
    }

    confirmLoad(doImport, () => { target.value = '' })
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
      .then(() => engine.setMsg('✓ URL copied to clipboard!'))
      .catch(() => setAppDialog({
        type: 'prompt',
        title: 'Share URL',
        message: 'Copy this URL:',
        defaultValue: url
      }))
  }

  function loadExample(key) {
    confirmLoad(() => {
      const sep  = key.indexOf('::')
      const code = EXAMPLES[key.slice(0, sep)]?.[key.slice(sep + 2)]
      if (!code) return
      setActiveChallenge(null)
      srcRef.current = code
      setSrc(code)
      engine.doAssemble(code)
      const name = key.slice(sep + 2)
      setFileName(name); localStorage.setItem('sim8085_filename', name)
      setReadOnlySource('Example')
    })
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
    engine.setMsg('✓ Code formatted')
  }

  function loadChallenge(c) {
    confirmLoad(() => {
      const code = `; Challenge: ${c.title}\n; ${c.desc}\n\n${c.setup ? c.setup + '\n\n' : ''}    org 100H\n    kickoff 100H\n\n    ; --- YOUR CODE GOES HERE ---\n    ; (Delete the NOP and write your solution)\n    nop\n\n    hlt\n`
      srcRef.current = code
      setSrc(code)
      engine.doAssemble(code)
      setFileName(c.title + '.asm')
      localStorage.setItem('sim8085_filename', c.title + '.asm')
      setActiveChallenge(c)
      setReadOnlySource('Challenge')
      handleSetView('simulator')
    })
  }

  function loadSolution(c) {
    confirmLoad(() => {
      const code = `; Solution: ${c.title}\n; ${c.desc}\n\n${c.setup ? c.setup + '\n\n' : ''}    org 100H\n    kickoff 100H\n\n; ── SOLUTION STARTS HERE ────────────────────────────\n${c.solution}\n; ── SOLUTION ENDS HERE ──────────────────────────────\n\n    hlt\n`
      srcRef.current = code
      setSrc(code)
      engine.doAssemble(code)
      setFileName(c.title + ' - Solution.asm')
      localStorage.setItem('sim8085_filename', c.title + ' - Solution.asm')
      setActiveChallenge(c)
      setReadOnlySource('Solution')
      handleSetView('simulator')
    })
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
    const isRetro = RETRO_THEMES.includes(theme)
    if (!isRetro || crtGlitch !== 'chaos') { setChaosCalm(false); return }
    let id
    const tick = (calm) => { id = setTimeout(() => { setChaosCalm(!calm); tick(!calm) }, calm ? 1000 : 4000) }
    setChaosCalm(false)
    tick(false)
    return () => clearTimeout(id)
  }, [theme, crtGlitch])

  const isRetroTheme = RETRO_THEMES.includes(theme)

  const simCtxValue = useMemo(
    () => ({ regBase, onRegBase: setRegBase, onEdit: engine.refresh, onShowDialog: setAppDialog }),
    [regBase] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <SimulatorContext.Provider value={simCtxValue}>
    <div className={`app${isRetroTheme && crtGlitch !== 'off' ? ` crt-glitch-${crtGlitch}` : ''}${isRetroTheme && !crtVignette ? ' crt-no-vignette' : ''}`} style={isRetroTheme ? { filter: `brightness(${crtBrightness}) contrast(${crtContrast})` } : undefined}>
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
            memSize={engine.memSize} onMemSize={engine.changeMemSize}
            engineMode={engine.engineMode} onEngineSwitch={engine.handleEngineSwitch}
            engineSwitching={engine.engineSwitching}
            theme={theme} onTheme={toggleTheme} onSetTheme={setTheme}
            crtBrightness={crtBrightness} onCrtBrightness={v => { setCrtBrightness(v); localStorage.setItem(`sim8085_crt_b_${theme}`, v) }}
            crtContrast={crtContrast} onCrtContrast={v => { setCrtContrast(v); localStorage.setItem(`sim8085_crt_c_${theme}`, v) }}
            crtGlitch={crtGlitch} onCrtGlitch={() => { const modes = ['off','flicker','static','vsync','hsync','chroma','chaos']; const next = modes[(modes.indexOf(crtGlitch) + 1) % modes.length]; setCrtGlitch(next); localStorage.setItem('sim8085_crt_glitch', next) }}
            crtVignette={crtVignette} onCrtVignette={v => { setCrtVignette(v); localStorage.setItem('sim8085_crt_vignette', String(v)) }}
            onManageGithub={() => setShowGithubSetup(true)}
            panels={panels} onTogglePanel={togglePanel}
            activeView={activeView} onSetView={handleSetView}
            onBrewCoffee={onBrewCoffee} />
          <div className="view-tabs">
            <button className={`view-tab${activeView === 'simulator' ? ' active' : ''}`} onClick={() => handleSetView('simulator')}>Simulator</button>
            <button className={`view-tab${activeView === 'breadboard' ? ' active' : ''}`} onClick={() => handleSetView('breadboard')}>Hardware</button>
            <button className={`view-tab${activeView === 'challenges' ? ' active' : ''}`} onClick={() => handleSetView('challenges')}>Challenges</button>
            <button className={`view-tab${activeView === 'community' ? ' active' : ''}`} onClick={() => handleSetView('community')}>Community</button>
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
        <span className={`engine-chip engine-chip-${engine.engineMode}`} style={{ marginLeft: 'auto' }} title={engine.engineSwitching ? 'Switching engine…' : `Engine: ${engine.engineMode.toUpperCase()}`}>
          {engine.engineSwitching ? '…' : `Engine: ${engine.engineMode.toUpperCase()}`}
        </span>
        <span className="build-chip" title="Build timestamp">Build: {BUILD_TIME_STR}</span>
      </div>


      {/* ── Simulator & Breadboard Views ── */}
      <div style={{ display: (activeView === 'simulator' || activeView === 'breadboard') ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <Toolbar
          onLoadExample={loadExample}
          panels={panels}
          onTogglePanel={togglePanel}
          fileInputRef={fileInputRef}
          onImportFile={importFile}
          isDirty={engine.isDirty}
          onBuild={handleBuild}
          running={engine.running}
          appState={engine.appState}
          onStep={engine.doStep}
          onStepOver={engine.doStepOver}
          onStepOut={engine.doStepOut}
          onStepBack={engine.doStepBack}
          histLen={engine.histLen}
          onRun={engine.handleRun}
          runSpeed={runSpeed}
          onSpeedChange={e => { const v = +e.target.value; setRunSpeed(v); localStorage.setItem('sim8085_speed', v); engine.setRunSpeed?.(v); }}
          onReset={handleReset}
        />

        {engine.maxHistLen > 0 && (
          <div className="time-travel-bar" style={{ padding: '4px 10px', background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>TIME TRAVEL</span>
            <input type="range" min="0" max={engine.maxHistLen} value={engine.histIndex} onChange={(e) => engine.seekHistory && engine.seekHistory(parseInt(e.target.value))} style={{ flex: 1, cursor: 'pointer', accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', minWidth: 60, textAlign: 'right' }}>{engine.histIndex} / {engine.maxHistLen}</span>
          </div>
        )}

        <div style={{ display: activeView === 'simulator' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <PanelWorkspace
            mobileTab={mobileTab}
            theme={theme}
            src={src} setSrc={setSrc} srcRef={srcRef}
            engine={engine}
            panels={panels}
            setAppDialog={setAppDialog}
            setHelpInst={setHelpInst}
            formatCode={formatCode}
            openConditionDialog={openConditionDialog}
            readOnlySource={readOnlySource}
          />
        </div>

        {activeView === 'breadboard' && (
          breadboardPoppedOut ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text2)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🪟</div>
              <div>Hardware view is currently open in another window.</div>
              <button className="btn" style={{ marginTop: 16 }} onClick={() => { setBreadboardPoppedOut(false); setActiveView('breadboard'); }}>Bring it back</button>
            </div>
          ) : (
            <BreadboardView engine={engine} panels={panels} togglePanel={togglePanel} ppiPos={ppiPos} setPpiPos={setPpiPos} pitPos={pitPos} setPitPos={setPitPos} ledPos={ledPos} setLedPos={setLedPos} onPopOut={() => { setBreadboardPoppedOut(true); setActiveView('simulator'); }} />
          )
        )}
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
          {engine.isDirty && <><span className="sbar-counter" style={{ color: 'var(--amber)', fontWeight: 600 }}>• editor out of sync</span><span className="sbar-sep">·</span></>}
          {engine.running && SPEEDS[runSpeed].warp && <><span className="sbar-counter" style={{ color: 'var(--accent)', fontWeight: 600 }} title="UI is updating once per second to maximize throughput">⚡ UI Throttled</span><span className="sbar-sep">·</span></>}
          <span className="sbar-counter sc-steps" title={`${engine.steps.toLocaleString()} instructions executed`}>{fmtCount(engine.steps)} steps</span>
          <span className="sbar-sep">·</span>
          <span className="sbar-counter sc-cycles" title={`${engine.cycles.toLocaleString()} T-states elapsed`}>{fmtCount(engine.cycles)} T</span>
          <span className="sbar-sep">·</span>
          <span className="sbar-counter sc-mhz" title="Simulated throughput">{engine.mhz >= 1000 ? `${(engine.mhz/1000).toFixed(2)} GHz` : engine.mhz >= 1 ? `${engine.mhz.toFixed(2)} MHz` : `${(engine.mhz*1000).toFixed(2)} kHz`}</span>
        </div>
      </div>
      {showWelcome && <WelcomeModal onClose={dismissWelcome} onBrewCoffee={onBrewCoffee} />}
      {helpInst && <HelpModal instruction={helpInst} onClose={() => setHelpInst(null)} />}
      
      {(activeView === 'simulator' || activeView === 'breadboard') && showCalc && (
        <CalcFloat onClose={() => setShowCalc(false)} />
      )}

      {showChat && <ChatPanel regs={engine.regs} src={src} symbols={engine.symbols} breakpoints={engine.bps} callStack={engine.callStack} onClose={() => setShowChat(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {driveFiles !== null && <DriveLoadModal files={driveFiles} loading={driveLoading} onClose={() => setDriveFiles(null)} onSelect={(id, name) => confirmLoad(() => { setReadOnlySource(null); fetchDriveFile(id, name) })} onDelete={deleteDriveFile} />}
      {showGithubSetup && <GithubSetupModal onClose={() => setShowGithubSetup(false)} onSave={() => engine.setMsg('✓ GitHub token saved.')} />}
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

      {breadboardPoppedOut && (
        <PopoutWindow title="Hardware - sim8085" theme={theme} onClose={() => setBreadboardPoppedOut(false)}>
          <BreadboardView engine={engine} panels={panels} togglePanel={togglePanel} ppiPos={ppiPos} setPpiPos={setPpiPos} pitPos={pitPos} setPitPos={setPitPos} ledPos={ledPos} setLedPos={setLedPos} isPoppedOut />
        </PopoutWindow>
      )}
    </div>
    </SimulatorContext.Provider>
  )
}
