/**
 * simProxy.js
 * Active-backend proxy. App.jsx imports from here instead of the concrete
 * bridges. switchEngine('wasm'|'js') swaps the backend at runtime; all
 * subsequent sim.* calls are routed to the new backend automatically.
 */

import * as jsImpl   from './sim8085Bridge.js'
import * as wasmImpl from './sim8085WasmBridge.js'

let _impl = jsImpl

export function getEngineMode() { return _impl === wasmImpl ? 'wasm' : 'js' }

export async function switchEngine(mode) {
  if (mode === 'wasm') {
    try {
      await wasmImpl.simReady
      _impl = wasmImpl
      return { ok: true }
    } catch (e) {
      _impl = jsImpl
      return { ok: false, error: e.message }
    }
  }
  _impl = jsImpl
  return { ok: true }
}

// ── Proxied API ──────────────────────────────────────────────────────────────
export const simInit                = (...a) => _impl.simInit(...a)
export const simReset               = (...a) => _impl.simReset(...a)
export const simAssemble            = (...a) => _impl.simAssemble(...a)
export const simStep                = (...a) => _impl.simStep(...a)
export const simRun                 = (...a) => _impl.simRun(...a)
export const simGetRegisters        = (...a) => _impl.simGetRegisters(...a)
export const simSetRegisters        = (...a) => _impl.simSetRegisters(...a)
export const simGetMemory           = (...a) => _impl.simGetMemory(...a)
export const simReadByte            = (...a) => _impl.simReadByte(...a)
export const simWriteByte           = (...a) => _impl.simWriteByte(...a)
export const simGetPC               = (...a) => _impl.simGetPC(...a)
export const simGetSP               = (...a) => _impl.simGetSP(...a)
export const simSetBreakpoint       = (...a) => _impl.simSetBreakpoint(...a)
export const simClearBreakpoint     = (...a) => _impl.simClearBreakpoint?.(...a)
export const simClearAllBreakpoints = (...a) => _impl.simClearAllBreakpoints(...a)
export const simIsBreakpoint        = (...a) => _impl.simIsBreakpoint(...a)
export const simGetBreakpoints      = (...a) => _impl.simGetBreakpoints(...a)
export const simGetAllLeds          = (...a) => _impl.simGetAllLeds(...a)
export const simDisassemble         = (...a) => _impl.simDisassemble(...a)
export const simGetError            = (...a) => _impl.simGetError(...a)
export const simIsHalted            = (...a) => _impl.simIsHalted(...a)
export const simIsRunning           = (...a) => _impl.simIsRunning(...a)
export const simIsHaltWaiting       = (...a) => _impl.simIsHaltWaiting(...a)
export const simAssertInterrupt     = (...a) => _impl.simAssertInterrupt(...a)
export const simDeassertInterrupt   = (...a) => _impl.simDeassertInterrupt(...a)
export const simGetIntState         = (...a) => _impl.simGetIntState(...a)
export const simEnqueueKeys         = (...a) => _impl.simEnqueueKeys(...a)
export const simClearKeyQueue       = (...a) => _impl.simClearKeyQueue(...a)
export const simGetKeyQueue         = (...a) => _impl.simGetKeyQueue(...a)
export const simSetMemorySize       = (...a) => _impl.simSetMemorySize(...a)
export const simGetMemorySize       = (...a) => _impl.simGetMemorySize(...a)
export const simGetFullMemory       = (...a) => _impl.simGetFullMemory(...a)
export const simRestoreSnapshot     = (...a) => _impl.simRestoreSnapshot(...a)
export const simSetInputPort        = (...a) => _impl.simSetInputPort(...a)
export const simClearInputPort      = (...a) => _impl.simClearInputPort(...a)
export const simGetInputPort        = (...a) => _impl.simGetInputPort(...a)
export const simGetOutputPorts      = (...a) => _impl.simGetOutputPorts(...a)
export const simGetConsoleOutput    = (...a) => _impl.simGetConsoleOutput(...a)
export const simClearConsoleOutput  = (...a) => _impl.simClearConsoleOutput(...a)
export const simSetConsolePort      = (...a) => _impl.simSetConsolePort(...a)
export const simGetConsolePort      = (...a) => _impl.simGetConsolePort(...a)
export const simGetSymbols          = (...a) => _impl.simGetSymbols(...a)
export const simGetCycles           = (...a) => _impl.simGetCycles(...a)
export const simSetCycles           = (...a) => _impl.simSetCycles(...a)
export const simGetProgramRegion    = (...a) => _impl.simGetProgramRegion(...a)
export const simGetPresetAddrs      = (...a) => _impl.simGetPresetAddrs(...a)