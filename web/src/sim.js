/**
 * sim.js — switchable simulator backend
 *
 * Delegates all calls to whichever backend is active (JS or WASM).
 * Swap at runtime via setBackend('wasm') / setBackend('js').
 */

import * as jsBridge from './sim8085Bridge.js'

let _backend = jsBridge
let _name = 'js'

export async function setBackend(name) {
  if (name === _name) return
  if (name === 'wasm') {
    const mod = await import('./sim8085WasmBridge.js')
    await mod.simReady
    _backend = mod
  } else {
    _backend = jsBridge
  }
  _name = name
}

export function getBackend() { return _name }

// ── Delegating exports ─────────────────────────────────────────────────────
// Each arrow function closes over _backend so it always uses the active one.

export const simInit                = (...a) => _backend.simInit(...a)
export const simReset               = (...a) => _backend.simReset(...a)
export const simAssemble            = (...a) => _backend.simAssemble(...a)
export const simStep                = (...a) => _backend.simStep(...a)
export const simRun                 = (...a) => _backend.simRun(...a)
export const simGetRegisters        = (...a) => _backend.simGetRegisters(...a)
export const simSetRegisters        = (...a) => _backend.simSetRegisters(...a)
export const simGetMemory           = (...a) => _backend.simGetMemory(...a)
export const simReadByte            = (...a) => _backend.simReadByte(...a)
export const simWriteByte           = (...a) => _backend.simWriteByte(...a)
export const simGetPC               = (...a) => _backend.simGetPC(...a)
export const simGetSP               = (...a) => _backend.simGetSP(...a)
export const simSetBreakpoint       = (...a) => _backend.simSetBreakpoint(...a)
export const simClearBreakpoint     = (...a) => _backend.simClearBreakpoint?.(...a)
export const simClearAllBreakpoints = (...a) => _backend.simClearAllBreakpoints(...a)
export const simIsBreakpoint        = (...a) => _backend.simIsBreakpoint(...a)
export const simGetBreakpoints      = (...a) => _backend.simGetBreakpoints?.() ?? []
export const simGetAllLeds          = (...a) => _backend.simGetAllLeds(...a)
export const simDisassemble         = (...a) => _backend.simDisassemble(...a)
export const simGetError            = (...a) => _backend.simGetError(...a)
export const simIsHalted            = (...a) => _backend.simIsHalted(...a)
export const simIsRunning           = (...a) => _backend.simIsRunning(...a)
export const simIsHaltWaiting       = (...a) => _backend.simIsHaltWaiting(...a)
export const simAssertInterrupt     = (...a) => _backend.simAssertInterrupt(...a)
export const simDeassertInterrupt   = (...a) => _backend.simDeassertInterrupt(...a)
export const simGetIntState         = (...a) => _backend.simGetIntState(...a)
export const simEnqueueKeys         = (...a) => _backend.simEnqueueKeys(...a)
export const simClearKeyQueue       = (...a) => _backend.simClearKeyQueue(...a)
export const simGetKeyQueue         = (...a) => _backend.simGetKeyQueue(...a)
export const simSetMemorySize       = (...a) => _backend.simSetMemorySize(...a)
export const simGetMemorySize       = (...a) => _backend.simGetMemorySize(...a)
export const simGetFullMemory       = (...a) => _backend.simGetFullMemory(...a)
export const simRestoreSnapshot     = (...a) => _backend.simRestoreSnapshot(...a)
export const simSetInputPort        = (...a) => _backend.simSetInputPort(...a)
export const simClearInputPort      = (...a) => _backend.simClearInputPort(...a)
export const simGetInputPort        = (...a) => _backend.simGetInputPort?.(...a) ?? 0
export const simGetOutputPorts      = (...a) => _backend.simGetOutputPorts(...a)
export const simGetSymbols          = (...a) => _backend.simGetSymbols?.() ?? {}
export const simGetCycles           = (...a) => _backend.simGetCycles?.() ?? 0
export const simGetProgramRegion    = (...a) => _backend.simGetProgramRegion?.() ?? null
export const simGetPresetAddrs      = (...a) => _backend.simGetPresetAddrs?.() ?? new Set()
