import { useState, useEffect, useRef } from 'react'
import * as sim from './simProxy.js'
import { getEngineMode, switchEngine } from './simProxy.js'
import { hex4, SPEEDS, evalCondition } from './utils.js'

const INITIAL_PC = 0x100
const MEM_START_DEFAULT = 0x100
const MEM_SIZES = [16 * 1024, 32 * 1024, 64 * 1024]
const LED_COUNT = 8

let _buildAddrLineMapCache = null

function buildAddrLineMap(code) {
  if (_buildAddrLineMapCache?.code === code) return _buildAddrLineMapCache.map
  const map = new Map()
  let pc = 0
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i].replace(/;.*$/, '').trim().toLowerCase()
    if (!text) continue
    if (text.startsWith('org ')) { pc = parseInt(text.slice(4).replace(/h$/, ''), 16) || pc; continue }
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

export function useSimulatorEngine(srcRef) {
  const [regs, setRegs] = useState({ a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, flags: 0, pc: INITIAL_PC, sp: 0, flagS: 0, flagZ: 0, flagAC: 0, flagP: 0, flagCY: 0, halted: false, hasError: false })
  const [prevRegs, setPrev] = useState(null)
  const [leds, setLeds] = useState(Array(LED_COUNT).fill(0))
  const [bps, setBps] = useState(() => {
    try { return new Map(JSON.parse(localStorage.getItem('sim8085_bps')) || []) } catch { return new Map() }
  })
  const [dataBps, setDataBps] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('sim8085_databps')) || []) } catch { return new Set() }
  })
  const [callStack, setCallStack] = useState([])
  const callStackRef = useRef([])
  const [hitcnts, setHitcnts] = useState(null)
  const [maxHit, setMaxHit] = useState(0)
  const [trace, setTrace] = useState([])
  const [changedAddrs, setChangedAddrs] = useState(new Set())
  const [watches, setWatches] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sim8085_watches')) || [] } catch { return [] }
  })
  const [outputPorts, setOutputPorts] = useState([])
  const [inputPresets, setInputPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sim8085_io_presets')) || [] } catch { return [] }
  })
  const [keyQueue, setKeyQueue] = useState([])
  const [intState, setIntState] = useState(() => sim.simGetIntState())
  const [sid, setSid] = useState(0)
  const [sod, setSod] = useState(0)
  const [memStart, setMemStart] = useState(MEM_START_DEFAULT)
  const [appState, setAppState] = useState('idle')
  const [engineMode, setEngineMode] = useState('js')
  const [engineSwitching, setEngineSwitching] = useState(false)
  const engineSwitchingRef = useRef(false)
  const [msg, setMsg] = useState('Load an example or write code, then click Build.')
  const [steps, setSteps] = useState(0)
  const [mhz, setMhz] = useState(0)
  const [cycles, setCycles] = useState(0)
  const [pcFlash, setPcFlash] = useState(0)
  const [buildId, setBuildId] = useState(0)
  const [symbols, setSymbols] = useState({})
  const [programRegion, setProgramRegion] = useState(null)
  const [presetAddrs, setPresetAddrs] = useState(new Set())
  const [errorLine, setErrorLine] = useState(null)
  const [consoleOutput, setConsoleOutput] = useState('')
  const [consolePort, setConsolePort] = useState(() => sim.simGetConsolePort())
  const [histLen, setHistLen] = useState(0)
  const [addrLineMap, setAddrLineMap] = useState(new Map())
  const [memSize, _setMemSize] = useState(() => {
    const s = parseInt(localStorage.getItem('sim8085_memsize'), 10)
    return MEM_SIZES.includes(s) ? s : 64 * 1024
  })

  const memSizeRef = useRef(memSize)
  const lineAddrRef = useRef(new Map())
  const speedRef = useRef((() => { const s = parseInt(localStorage.getItem('sim8085_speed'), 10); return s >= 0 && s < SPEEDS.length ? s : 3 })())
  const historyRef = useRef([])
  const bpsRef = useRef(new Map())
  const prevMemRef = useRef(null)
  const lastBuiltSrcRef = useRef(srcRef.current)
  const timerRef = useRef(null)
  const warpActiveRef = useRef(false)
  const warpWorkerRef = useRef(null)
  const workerReadyPromise = useRef(null)
  const warpWorkerActiveRef = useRef(false)
  const lastUiRef = useRef(0)
  const wasHaltWaitingRef = useRef(false)
  const throughputRef = useRef({ steps: 0, ms: 0, mhz: 0 })
  const oneShotBpsRef = useRef(new Set())

  useEffect(() => { bpsRef.current = bps }, [bps])

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
    const end = Math.min((pr?.end ?? 0x200) + 16, 0xFFFF)
    const len = end - start + 1
    if (len <= 0) return
    const counts = sim.simGetHitcntRange(start, len)
    let mx = 0; const m = new Map()
    for (let i = 0; i < len; i++) {
      if (counts[i] > 0) { m.set(start + i, counts[i]); if (counts[i] > mx) mx = counts[i] }
    }
    setHitcnts(m.size > 0 ? m : null)
    setMaxHit(mx)
  }

  function refreshOutputPorts() {
    setOutputPorts(sim.simGetOutputPorts())
  }

  function changeConsolePort(n) {
    sim.simSetConsolePort(n)
    setConsolePort(n)
  }

  function doAssemble(code) {
    try {
      stopRun()
      historyRef.current = []
      setHistLen(0)
      setTrace([])
      setCallStack([]); callStackRef.current = []
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

  const CALL_OPS = new Set([0xCD, 0xC4, 0xCC, 0xD4, 0xDC, 0xE4, 0xEC, 0xF4, 0xFC])
  const RET_OPS = new Set([0xC9, 0xC0, 0xC8, 0xD0, 0xD8, 0xE0, 0xE8, 0xF0, 0xF8])
  const RST_OPS = new Set([0xC7, 0xCF, 0xD7, 0xDF, 0xE7, 0xEF, 0xF7, 0xFF])

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
    setPcFlash(f => f + 1)
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

  // haltTrigger is a counter incremented on every HLT, used by App for challenge evaluation
  const [haltTrigger, setHaltTrigger] = useState(0)

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
        const errMsg = over.errorMsg !== undefined ? over.errorMsg : sim.simGetError()
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
          if (!warpActiveRef.current) return
          const ram = sim.simGetFullMemory()
          const snap = {
            regs: sim.simGetRegisters(),
            ram,
            memSize: memSizeRef.current,
            breakpoints: [...bpsRef.current.entries()],
            dataBps: [...dataBps],
            inputPorts: sim.simGetAllInputPorts(),
            consolePort: sim.simGetConsolePort(),
            keyQueue: sim.simGetKeyQueue(),
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
        tp.steps += n; tp.ms += execMs; tp.pendingSteps = (tp.pendingSteps || 0) + n
        if (tp.ms >= 250) { tp.mhz = tp.steps / tp.ms / 1000; tp.steps = 0; tp.ms = 0 }
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
      if (tp.ms >= 100) { tp.mhz = tp.steps / tp.ms / 1000; tp.steps = 0; tp.ms = 0 }
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
      if (isHaltWaiting) { setMsg('⏸ HLT — awaiting interrupt…'); return }
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
      setAppState(s => s === 'running' ? 'idle' : s)
      return
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    const tp = throughputRef.current
    if (tp.pendingSteps > 0) { setSteps(s => s + tp.pendingSteps); tp.pendingSteps = 0 }
    wasHaltWaitingRef.current = false
    refresh()
    refreshOutputPorts()
    setAppState(s => s === 'running' ? 'idle' : s)
  }

  function handleRun() {
    if (appState === 'running') {
      stopRun()
      setMsg('⏹ Stopped.')
    } else {
      startRun()
    }
  }

  function addTraceEntry(prevR) {
    const r = sim.simGetRegisters()
    const d = sim.simDisassemble(prevR.pc)
    const SKIP = new Set(['pc', 'flags', 'halted', 'hasError'])
    const changed = Object.keys(prevR).filter(k => !SKIP.has(k) && typeof prevR[k] === 'number' && r[k] !== prevR[k])
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

  function runToAddr(addr) {
    if (!bpsRef.current.has(addr)) {
      oneShotBpsRef.current.add(addr)
      const next = new Map(bpsRef.current)
      next.set(addr, null)
      syncBps(next)
    }
    startRun()
  }

  function setInputPort(port, val) {
    sim.simSetInputPort(port, val)
    setInputPresets(ps => {
      const next = ps.filter(p => p.port !== port)
      return [...next, { port, val }].sort((a, b) => a.port - b.port)
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

  function setRunSpeed(v) {
    speedRef.current = v
  }

  const running = appState === 'running'
  const isDirty = srcRef.current !== lastBuiltSrcRef.current

  return {
    // state
    regs, prevRegs, leds,
    bps, dataBps, setDataBps,
    callStack,
    hitcnts, maxHit,
    trace, setTrace,
    changedAddrs,
    watches, setWatches,
    outputPorts,
    inputPresets, setInputPresets,
    keyQueue,
    intState,
    sid, setSid, sod,
    memStart, setMemStart,
    appState, setAppState,
    engineMode, engineSwitching,
    msg, setMsg,
    steps, mhz, cycles,
    pcFlash,
    buildId, setBuildId,
    symbols,
    programRegion, presetAddrs,
    errorLine,
    consoleOutput, setConsoleOutput,
    consolePort,
    histLen,
    addrLineMap,
    memSize,
    haltTrigger,
    // computed
    running,
    isDirty,
    // refs
    lineAddrRef,
    // methods
    refresh,
    doAssemble,
    doStep, doStepOver, doStepOut, doStepBack,
    handleRun,
    syncBps, toggleBp, clearAllBps,
    toggleDataBp, clearAllDataBps,
    runToAddr,
    setInputPort, removeInputPort,
    enqueueKeys, clearKeyQueue,
    handleEngineSwitch,
    changeMemSize,
    changeConsolePort,
    assertInterrupt, deassertInterrupt,
    setRunSpeed,
  }
}
