/**
 * sim8085WasmBridge.js
 * ──────────────────────────────────────────────────────────────
 * Drop-in WASM-backed replacement for sim8085Bridge.js.
 * Loads the Emscripten-compiled C core (sim8085.js must be
 * included as a <script> tag in index.html before ES modules run).
 *
 * API is intentionally identical to sim8085Bridge.js so the swap
 * is a one-line change.  The only difference: simInit() returns a
 * Promise that resolves when the WASM module is ready.  App.jsx
 * should call:
 *   Promise.resolve(sim.simInit()).then(() => doAssemble(src))
 * ──────────────────────────────────────────────────────────────
 */

let M = null;   // resolved Emscripten module

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src} — run the Emscripten build first`));
    document.head.appendChild(s);
  });
}

// Lazy-loads /sim8085.js if not already on the page, then instantiates WASM.
export const simReady = (async () => {
  if (typeof globalThis.Sim8085Module !== 'function') {
    await loadScript(import.meta.env.BASE_URL + 'sim8085.js');
  }
  if (typeof globalThis.Sim8085Module !== 'function') {
    throw new Error('sim8085.js loaded but Sim8085Module is not defined');
  }
  M = await globalThis.Sim8085Module();
})();

// ── JS-side mirrors for state not directly in the C API ────────────────────
const jsInputPorts = new Uint8Array(256); // mirrors KIT->cpu.input_ports[]
const jsBP = new Set();                   // mirrors C breakpoint table

// ── Heap helpers ──────────────────────────────────────────────────────────
function alloc(n)            { return M._malloc(n); }
function free(ptr)           { M._free(ptr); }
function heapRead(ptr, n)    { return new Uint8Array(M.HEAPU8.buffer, ptr, n).slice(); }
function heapWrite(ptr, src) { M.HEAPU8.set(src, ptr); }
function cstr(ptr)           { return M.UTF8ToString(ptr); }
function writeStr(s) {
  const ptr = alloc(s.length * 2 + 1);
  M.stringToUTF8(s, ptr, s.length * 2 + 1);
  return ptr;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
export function simInit() {
  if (M) {
    M._sim_init();
    jsInputPorts.fill(0);
    jsBP.clear();
    return;
  }
  return simReady.then(() => {
    M._sim_init();
    jsInputPorts.fill(0);
    jsBP.clear();
  });
}

export function simReset() {
  if (!M) return;
  M._sim_reset();
}

// ── Assembly ──────────────────────────────────────────────────────────────
export function simAssemble(source) {
  if (!M) return { ok: false, errorMsg: 'WASM not ready', errors: ['WASM not ready'] };
  const ptr = writeStr(source);
  const ok  = M._wasm_assemble(ptr);
  free(ptr);
  if (ok) {
    return {
      ok: true,
      entryPoint:   M._wasm_asm_entry_point(),
      bytesEmitted: M._wasm_asm_bytes_emitted(),
      errors: [],
    };
  }
  const msg = cstr(M._wasm_asm_error_msg());
  return { ok: false, errorMsg: msg, errors: [msg] };
}

// ── Execution ─────────────────────────────────────────────────────────────
export function simStep()              { return M ? !!M._sim_step() : false; }
export function simRun(maxSteps = 1e5) { return M ? M._sim_run(maxSteps) : 0; }

// ── Registers ─────────────────────────────────────────────────────────────
const ZERO_REGS = { a:0, b:0, c:0, d:0, e:0, h:0, l:0, flags:0, pc:0x100, sp:0,
  flagS:false, flagZ:false, flagAC:false, flagP:false, flagCY:false,
  status:0, halted:false, hasError:false };

export function simGetRegisters() {
  if (!M) return { ...ZERO_REGS };
  M._wasm_snap_regs();
  return {
    a:  M._wasm_reg_a(),     b:  M._wasm_reg_b(),
    c:  M._wasm_reg_c(),     d:  M._wasm_reg_d(),
    e:  M._wasm_reg_e(),     h:  M._wasm_reg_h(),
    l:  M._wasm_reg_l(),     flags: M._wasm_reg_flags(),
    pc: M._wasm_reg_pc(),    sp:  M._wasm_reg_sp(),
    flagS:  M._wasm_reg_flag_s(),
    flagZ:  M._wasm_reg_flag_z(),
    flagAC: M._wasm_reg_flag_ac(),
    flagP:  M._wasm_reg_flag_p(),
    flagCY: M._wasm_reg_flag_cy(),
    status:   M._wasm_reg_status(),
    halted:   !!M._wasm_reg_halted(),
    hasError: !!M._wasm_reg_has_error(),
  };
}

export function simSetRegisters(r) {
  if (!M) return;
  M._wasm_snap_regs();
  M._wasm_restore_regs(
    r.a     !== undefined ? r.a     : M._wasm_reg_a(),
    r.b     !== undefined ? r.b     : M._wasm_reg_b(),
    r.c     !== undefined ? r.c     : M._wasm_reg_c(),
    r.d     !== undefined ? r.d     : M._wasm_reg_d(),
    r.e     !== undefined ? r.e     : M._wasm_reg_e(),
    r.h     !== undefined ? r.h     : M._wasm_reg_h(),
    r.l     !== undefined ? r.l     : M._wasm_reg_l(),
    r.flags !== undefined ? r.flags : M._wasm_reg_flags(),
    r.pc    !== undefined ? r.pc    : M._wasm_reg_pc(),
    r.sp    !== undefined ? r.sp    : M._wasm_reg_sp(),
  );
}

// ── Memory ────────────────────────────────────────────────────────────────
export function simGetMemory(start, length) {
  if (!M) return new Uint8Array(length);
  const ptr = alloc(length);
  M._sim_get_memory(start, length, ptr);
  const out = heapRead(ptr, length);
  free(ptr);
  return out;
}

export function simReadByte(addr)      { return M ? M._sim_read_byte(addr) : 0; }
export function simWriteByte(addr, v)  { if (M) M._sim_write_byte(addr, v); }
export function simGetPC()             { return M ? M._sim_get_pc() : 0x100; }
export function simGetSP()             { return M ? M._sim_get_sp() : 0; }

// ── Breakpoints ───────────────────────────────────────────────────────────
export function simSetBreakpoint(addr) {
  if (!M) return 0;
  const r = M._sim_set_breakpoint(addr);
  if (r === 1) jsBP.add(addr);
  else if (r === 2) jsBP.delete(addr);
  return r;
}
export function simClearBreakpoint(addr) {
  if (!M) return;
  M._sim_clear_breakpoint(addr);
  jsBP.delete(addr);
}
export function simClearAllBreakpoints() {
  if (M) M._sim_clear_all_breakpoints();
  jsBP.clear();
}
export function simIsBreakpoint(addr) { return jsBP.has(addr); }
export function simGetBreakpoints()   { return [...jsBP]; }

// ── LED display ───────────────────────────────────────────────────────────
export function simGetAllLeds() {
  if (!M) return Array(8).fill(0);
  M._wasm_snap_leds();
  return Array.from({ length: 8 }, (_, i) => M._wasm_led(i));
}

// ── Disassembly ───────────────────────────────────────────────────────────
export function simDisassemble(addr) {
  if (!M) return { text: '', len: 1, addr, mnem: '', cycles: 0 };
  M._wasm_disassemble(addr);
  const text = cstr(M._wasm_disasm_text());
  const len  = M._wasm_disasm_len();
  return {
    text,
    len:    Math.max(1, len),
    addr,
    mnem:   text.trim().split(/[\s,]+/)[0] ?? '',
    cycles: 0,
  };
}

// ── Error / status ────────────────────────────────────────────────────────
export function simGetError()      { return M ? cstr(M._sim_get_error()) : ''; }
export function simIsHalted()      { return M ? !!M._sim_is_halted() : false; }
export function simIsRunning()     { return M ? !!M._sim_is_running() : false; }
export function simIsHaltWaiting() { return M ? !!M._sim_is_halt_waiting() : false; }

// ── Interrupts ────────────────────────────────────────────────────────────
const INT_TYPE = { TRAP: 0, RST75: 1, RST65: 2, RST55: 3 };
const ZERO_INTS = { iff: false, intMask: 0, rst75ff: false, trapPend: false,
                    rst65: false, rst55: false, intr: false, intrVec: 0xFF };

export function simAssertInterrupt(type, _vec) {
  if (!M) return;
  const t = INT_TYPE[type];
  if (t !== undefined) M._sim_assert_interrupt(t);
}
export function simDeassertInterrupt(type) {
  if (!M) return;
  const t = INT_TYPE[type];
  if (t !== undefined) M._sim_deassert_interrupt(t);
}
export function simGetIntState() {
  if (!M) return { ...ZERO_INTS };
  M._wasm_snap_ints();
  return {
    iff:      !!M._wasm_int_iff(),
    intMask:  M._wasm_int_mask(),
    rst75ff:  !!M._wasm_int_rst75ff(),
    trapPend: !!M._wasm_int_trap_pend(),
    rst65:    !!M._wasm_int_rst65(),
    rst55:    !!M._wasm_int_rst55(),
    intr:     false,
    intrVec:  0xFF,
  };
}

// ── Keyboard queue ────────────────────────────────────────────────────────
export function simEnqueueKeys(str) {
  if (!M) return;
  const ptr = writeStr(str);
  M._sim_enqueue_keys(ptr);
  free(ptr);
}
export function simClearKeyQueue() { if (M) M._sim_clear_key_queue(); }
export function simGetKeyQueue() {
  if (!M) return [];
  const ptr = alloc(256);
  const n   = M._sim_get_key_queue(ptr, 256);
  const out = [];
  for (let i = 0; i < n; i++) out.push(String.fromCharCode(M.HEAPU8[ptr + i]));
  free(ptr);
  return out;
}

// ── Memory size ───────────────────────────────────────────────────────────
export function simSetMemorySize(n) { if (M) M._sim_set_memory_size(n); }
export function simGetMemorySize()  { return M ? M._sim_get_memory_size() : 64 * 1024; }

// ── Full memory / step-back snapshots ─────────────────────────────────────
export function simGetFullMemory() {
  if (!M) return new Uint8Array(64 * 1024);
  const size = 64 * 1024;
  const ptr  = alloc(size);
  M._sim_get_full_memory(ptr);
  const out = heapRead(ptr, size);
  free(ptr);
  return out;
}

export function simRestoreSnapshot(snap) {
  if (!M) return;
  const ramPtr = alloc(snap.ram.length);
  heapWrite(ramPtr, snap.ram);
  M._sim_restore_snapshot(0, 0, ramPtr, snap.ram.length);
  free(ramPtr);
  const r = snap.regs;
  M._wasm_restore_regs(r.a, r.b, r.c, r.d, r.e, r.h, r.l, r.flags, r.pc, r.sp);
}

// ── I/O ports ─────────────────────────────────────────────────────────────
export function simSetInputPort(port, val) {
  const p = port & 0xFF, v = val & 0xFF;
  jsInputPorts[p] = v;
  if (M) M._sim_set_input_port(p, v);
}
export function simClearInputPort(port) {
  const p = port & 0xFF;
  jsInputPorts[p] = 0;
  if (M) M._sim_clear_input_port(p);
}
export function simGetInputPort(port) { return jsInputPorts[port & 0xFF]; }
export function simGetOutputPorts() {
  if (!M) return [];
  const ptr = alloc(256);
  M._wasm_get_all_output_ports(ptr);
  const result = [];
  for (let i = 0; i < 256; i++) {
    const v = M.HEAPU8[ptr + i];
    if (v) result.push({ port: i, val: v });
  }
  free(ptr);
  return result;
}

// ── Console output ────────────────────────────────────────────────────────
export function simGetConsoleOutput()  { return M ? cstr(M._sim_get_console_output()) : ''; }
export function simClearConsoleOutput(){ if (M) M._sim_clear_console_output(); }
export function simSetConsolePort(n)   { if (M) M._sim_set_console_port(n & 0xFF); }
export function simGetConsolePort()    { return M ? M._sim_get_console_port() : 0x01; }

// ── Stubs — JS-only features not yet in C core ────────────────────────────
export function simGetSymbols()       { return {}; }
export function simGetCycles()        { return 0; }
export function simSetCycles(_n)      { }
export function simGetProgramRegion() { return { start: 0x100, end: 0x100 }; }
export function simGetPresetAddrs()   { return new Set(); }
