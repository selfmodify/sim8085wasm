/**
 * simWorker.js — Web Worker for off-thread simulation
 *
 * Owns a JS engine instance. Accepts commands from the main thread and posts
 * back state snapshots. This prevents UI jank during fast execution modes.
 *
 * Commands (postMessage to worker):
 *   {cmd:'init'}
 *   {cmd:'assemble', src}
 *   {cmd:'step'}
 *   {cmd:'run', stepsPerTick, bps}   bps = [[addr, cond|null], ...]
 *   {cmd:'stop'}
 *   {cmd:'setInputPort', port, val}
 *   {cmd:'clearInputPort', port}
 *   {cmd:'setConsolePort', port}
 *   {cmd:'setMemorySize', n}
 *   {cmd:'setBreakpoint', addr}
 *   {cmd:'clearAllBreakpoints'}
 *   {cmd:'assertInterrupt', type, vec}
 *   {cmd:'deassertInterrupt', type}
 *   {cmd:'enqueueKeys', str}
 *   {cmd:'clearKeyQueue'}
 *   {cmd:'setDataBreakpoint', addr}
 *   {cmd:'clearAllDataBreakpoints'}
 *   {cmd:'setSID', val}
 *
 * Events (postMessage from worker):
 *   {evt:'ready'}
 *   {evt:'assembled', result}
 *   {evt:'stepped', state}
 *   {evt:'tick', steps}            — periodic progress during run
 *   {evt:'stopped', state, reason} — reason: 'bp'|'watchpoint'|'halted'|'error'|'user'
 */

import * as sim from './sim8085Bridge.js'

let running = false
let tickId  = null
let stepsPerTick = 1000
let bpMap   = new Map()   // addr -> cond | null
let lastUiMs = 0           // last time we sent a state snapshot with tick

function getState() {
  return {
    regs:    sim.simGetRegisters(),
    leds:    sim.simGetAllLeds(),
    cycles:  sim.simGetCycles(),
    halted:  sim.simIsHalted(),
    running: sim.simIsRunning(),
    error:   sim.simGetError(),
    console: sim.simGetConsoleOutput(),
    outputs: sim.simGetOutputPorts(),
    intState:sim.simGetIntState(),
    keyQueue:sim.simGetKeyQueue(),
    watchHit:sim.simGetDataWatchHit ? sim.simGetDataWatchHit() : -1,
    sod:     sim.simGetSOD ? sim.simGetSOD() : 0,
  }
}

function stopLoop(reason) {
  running = false
  if (tickId) { clearTimeout(tickId); tickId = null }
  postMessage({ evt: 'stopped', state: getState(), reason })
}

function runTick() {
  if (!running) return
  const n = sim.simRun(stepsPerTick)
  const now = performance.now()
  const doUi = (now - lastUiMs) >= 16
  if (doUi) lastUiMs = now
  postMessage({ evt: 'tick', steps: n, state: doUi ? getState() : null })

  if (sim.simIsHaltWaiting()) {
    tickId = setTimeout(runTick, 10)
    return
  }

  const r = sim.simGetRegisters()
  const watchHit = sim.simGetDataWatchHit ? sim.simGetDataWatchHit() : -1

  if (watchHit >= 0) { stopLoop('watchpoint'); return }

  if (!sim.simIsRunning()) {
    stopLoop(sim.simIsHalted() ? 'halted' : 'error')
    return
  }

  if (bpMap.has(r.pc)) {
    const cond = bpMap.get(r.pc)
    if (!cond || evalCond(cond, r)) { stopLoop('bp'); return }
  }

  tickId = setTimeout(runTick, 0)
}

function evalCond(expr, r) {
  try {
    const BC = (r.b<<8)|r.c, DE = (r.d<<8)|r.e, HL = (r.h<<8)|r.l
    // eslint-disable-next-line no-new-func
    return !!new Function('A','B','C','D','E','H','L','PC','SP','BC','DE','HL','FLAGS',
      `return !!(${expr})`)(r.a,r.b,r.c,r.d,r.e,r.h,r.l,r.pc,r.sp,BC,DE,HL,r.flags)
  } catch { return true }
}

self.onmessage = function({ data }) {
  const { cmd } = data
  switch (cmd) {
    case 'init':
      sim.simInit()
      postMessage({ evt: 'ready' })
      break

    case 'assemble':
      sim.simInit()
      const res = sim.simAssemble(data.src)
      postMessage({ evt: 'assembled', result: res })
      break

    case 'step':
      sim.simStep()
      postMessage({ evt: 'stepped', state: getState() })
      break

    case 'run':
      if (running) break
      stepsPerTick = data.stepsPerTick || 1000
      bpMap = new Map(data.bps || [])
      running = true
      tickId = setTimeout(runTick, 0)
      break

    case 'stop':
      stopLoop('user')
      break

    case 'setInputPort':    sim.simSetInputPort(data.port, data.val); break
    case 'clearInputPort':  sim.simClearInputPort(data.port); break
    case 'setConsolePort':  sim.simSetConsolePort(data.port); break
    case 'setMemorySize':   sim.simSetMemorySize(data.n); break
    case 'setBreakpoint':   sim.simSetBreakpoint(data.addr); break
    case 'clearAllBreakpoints': sim.simClearAllBreakpoints(); break
    case 'assertInterrupt': sim.simAssertInterrupt(data.intType, data.vec); break
    case 'deassertInterrupt': sim.simDeassertInterrupt(data.intType); break
    case 'enqueueKeys':     sim.simEnqueueKeys(data.str); break
    case 'clearKeyQueue':   sim.simClearKeyQueue(); break
    case 'setDataBreakpoint': sim.simSetDataBreakpoint(data.addr); break
    case 'clearAllDataBreakpoints': sim.simClearAllDataBreakpoints(); break
    case 'setSID':          sim.simSetSID(data.val); break
  }
}
