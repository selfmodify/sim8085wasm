/*
 * sim.worker.js — Web Worker for warp-speed 8085 simulation.
 *
 * Classic (non-module) worker loaded from public/ so it can call importScripts.
 * The main thread sends { cmd:'init', baseUrl } first; the worker loads the
 * Emscripten WASM bundle via importScripts then replies { type:'ready' }.
 * Subsequent { cmd:'startWarp', snap } runs the sim freely in the background,
 * posting stateUpdate / haltWaiting / stopped messages back to the main thread.
 */
'use strict';

let M = null;
let running = false;
let stopRequested = false;
let bpMap = new Map();     // addr → cond string | null
let jsDBP = new Set();     // write-watchpoint addresses (JS-side)
let jsDataWatchHit = -1;
const throughput = { steps: 0, ms: 0, mhz: 0, pendingSteps: 0 };
let lastUiMs = 0;
let wasHaltWaiting = false;

// ── WASM heap helpers ─────────────────────────────────────────────────────────
const alloc = n => M._malloc(n);
const free_ = p => M._free(p);
const cstr  = p => M.UTF8ToString(p);

function heapRead(p, n) { return new Uint8Array(M.HEAPU8.buffer, p, n).slice(); }
function heapWrite(p, src) { M.HEAPU8.set(src, p); }
function writeStr(s) {
  const p = alloc(s.length * 4 + 1);
  M.stringToUTF8(s, p, s.length * 4 + 1);
  return p;
}

// ── Restore CPU state from a main-thread snapshot ─────────────────────────────
function initFromSnap(snap) {
  if (snap.memSize) M._sim_set_memory_size(snap.memSize);

  // Restore RAM (also resets status flags to 0 via sim_restore_snapshot)
  const ramPtr = alloc(snap.ram.length);
  heapWrite(ramPtr, snap.ram);
  M._sim_restore_snapshot(0, 0, ramPtr, snap.ram.length);
  free_(ramPtr);

  // Restore registers
  const r = snap.regs;
  M._wasm_restore_regs(r.a, r.b, r.c, r.d, r.e, r.h, r.l, r.flags, r.pc, r.sp);

  // Breakpoints
  M._sim_clear_all_breakpoints();
  for (const [addr] of snap.breakpoints) M._sim_set_breakpoint(addr);

  // Input ports
  if (snap.inputPorts) {
    for (let i = 0; i < snap.inputPorts.length; i++) {
      if (snap.inputPorts[i]) M._sim_set_input_port(i, snap.inputPorts[i]);
    }
  }

  // Console port & key queue
  M._sim_set_console_port(snap.consolePort & 0xFF);
  if (snap.keyQueue?.length) {
    const ks = snap.keyQueue.join('');
    const kp = writeStr(ks);
    M._sim_enqueue_keys(kp);
    free_(kp);
  }
}

// ── simRun with JS-side data watchpoints ──────────────────────────────────────
function doRun(maxSteps) {
  jsDataWatchHit = -1;
  if (jsDBP.size === 0) return M._sim_run(maxSteps);
  const addrs = [...jsDBP];
  let steps = 0;
  while (steps < maxSteps) {
    const before = addrs.map(a => M._sim_read_byte(a));
    if (!M._sim_step()) break;
    steps++;
    for (let i = 0; i < addrs.length; i++) {
      if (M._sim_read_byte(addrs[i]) !== before[i]) { jsDataWatchHit = addrs[i]; return steps; }
    }
  }
  return steps;
}

// ── State snapshot helpers ────────────────────────────────────────────────────
function snapRegs() {
  M._wasm_snap_regs();
  return {
    a: M._wasm_reg_a(), b: M._wasm_reg_b(), c: M._wasm_reg_c(), d: M._wasm_reg_d(),
    e: M._wasm_reg_e(), h: M._wasm_reg_h(), l: M._wasm_reg_l(),
    flags: M._wasm_reg_flags(), pc: M._wasm_reg_pc(), sp: M._wasm_reg_sp(),
    flagS:  !!M._wasm_reg_flag_s(), flagZ:  !!M._wasm_reg_flag_z(),
    flagAC: !!M._wasm_reg_flag_ac(), flagP:  !!M._wasm_reg_flag_p(),
    flagCY: !!M._wasm_reg_flag_cy(),
    status: M._wasm_reg_status(),
    halted: !!M._wasm_reg_halted(), hasError: !!M._wasm_reg_has_error(),
  };
}

function snapState() {
  const regs = snapRegs();
  M._wasm_snap_leds();
  const leds = Array.from({ length: 8 }, (_, i) => M._wasm_led(i));
  const lo = M._sim_get_cycles_lo() >>> 0;
  const hi = M._sim_get_cycles_hi() >>> 0;
  const cycles = hi * 0x100000000 + lo;
  const consoleOutput = cstr(M._sim_get_console_output());
  M._wasm_snap_ints();
  const intState = {
    iff: !!M._wasm_int_iff(), intMask: M._wasm_int_mask(),
    rst75ff: !!M._wasm_int_rst75ff(), trapPend: !!M._wasm_int_trap_pend(),
    rst65: !!M._wasm_int_rst65(), rst55: !!M._wasm_int_rst55(),
    intr: false, intrVec: 0xFF,
  };
  const sod = M._sim_get_sod_api ? M._sim_get_sod_api() : 0;
  const opPtr = alloc(256);
  M._wasm_get_all_output_ports(opPtr);
  const outputPorts = [];
  for (let i = 0; i < 256; i++) { const v = M.HEAPU8[opPtr + i]; if (v) outputPorts.push({ port: i, val: v }); }
  free_(opPtr);
  const kPtr = alloc(256);
  const kN = M._sim_get_key_queue(kPtr, 256);
  const keyQueue = [];
  for (let i = 0; i < kN; i++) keyQueue.push(String.fromCharCode(M.HEAPU8[kPtr + i]));
  free_(kPtr);
  return { regs, leds, cycles, consoleOutput, intState, sod, outputPorts, keyQueue };
}

function captureRam() {
  const ptr = alloc(65536);
  M._sim_get_full_memory(ptr);
  const ram = heapRead(ptr, 65536);
  free_(ptr);
  return ram;
}

// ── Conditional breakpoint evaluator (mirrors App.jsx evalCondition) ───────────
function evalCond(cond, r) {
  if (!cond) return true;
  try {
    const expr = cond.replace(/\{(\w+)\}/gi, (_, n) => r[n.toLowerCase()] ?? 0);
    return !!(new Function('return (' + expr + ')'))(); // eslint-disable-line no-new-func
  } catch { return true; }
}

// ── Tick scheduler — MessageChannel gives near-zero overhead vs setTimeout ────
const tickChannel = new MessageChannel();
tickChannel.port1.onmessage = () => warpTick();
function scheduleTick() { tickChannel.port2.postMessage(null); }

// ── Warp execution loop ───────────────────────────────────────────────────────
function warpTick() {
  if (!running) return;

  // Run at full speed for up to 100 ms per tick
  let n = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 100) {
    const chunk = doRun(2000000);
    n += chunk;
    if (chunk < 2000000) break;   // sim stopped early
    if (stopRequested) break;
  }
  const execMs = performance.now() - t0;

  throughput.steps += n;
  throughput.ms    += execMs;
  throughput.pendingSteps += n;
  if (throughput.ms >= 250) {
    throughput.mhz   = throughput.steps / throughput.ms / 1000;
    throughput.steps = throughput.ms = 0;
  }

  const now = performance.now();
  const isHaltWaiting = !!M._sim_is_halt_waiting();
  const doUi = (now - lastUiMs >= 1000) || (isHaltWaiting && !wasHaltWaiting);

  if (doUi) {
    const st = snapState();
    const ps = throughput.pendingSteps; throughput.pendingSteps = 0;
    self.postMessage({
      type: 'stateUpdate', pendingSteps: ps, mhz: throughput.mhz,
      regs: st.regs, leds: st.leds, cycles: st.cycles,
      consoleOutput: st.consoleOutput, intState: st.intState,
      sod: st.sod, outputPorts: st.outputPorts, keyQueue: st.keyQueue,
    });
    lastUiMs = now;
  }
  wasHaltWaiting = isHaltWaiting;

  // ── User requested stop ───────────────────────────────────────────────────
  if (stopRequested) {
    running = false;
    const st  = snapState();
    const ram = captureRam();
    self.postMessage({
      type: 'stopped', reason: 'stopped', atBp: false, watchHit: -1,
      isHalted: false, errorMsg: '',
      regs: st.regs, leds: st.leds, cycles: st.cycles, ram,
      consoleOutput: st.consoleOutput, intState: st.intState,
      sod: st.sod, outputPorts: st.outputPorts, keyQueue: st.keyQueue,
    }, [ram.buffer]);
    return;
  }

  // ── HLT waiting for interrupt ─────────────────────────────────────────────
  if (isHaltWaiting) {
    self.postMessage({ type: 'haltWaiting' });
    setTimeout(warpTick, 16);
    return;
  }

  // ── Check for natural termination or breakpoint ───────────────────────────
  M._wasm_snap_regs();
  const pc      = M._wasm_reg_pc();
  const atBp    = bpMap.has(pc);
  const watchHit = jsDataWatchHit;

  if (!M._sim_is_running() || atBp || watchHit >= 0) {
    // Conditional breakpoint — skip if condition not met
    if (atBp && watchHit < 0) {
      const cond = bpMap.get(pc);
      if (cond != null && !evalCond(cond, snapRegs())) {
        jsDataWatchHit = -1;
        M._sim_step();
        scheduleTick();
        return;
      }
    }

    running = false;
    const isHalted = !!M._sim_is_halted();
    const errorMsg = isHalted ? '' : cstr(M._sim_get_error());
    const reason   = watchHit >= 0 ? 'watchpoint' : atBp ? 'breakpoint' : isHalted ? 'halted' : 'error';
    const st  = snapState();
    const ram = captureRam();
    self.postMessage({
      type: 'stopped', reason, atBp, watchHit, isHalted, errorMsg,
      regs: st.regs, leds: st.leds, cycles: st.cycles, ram,
      consoleOutput: st.consoleOutput, intState: st.intState,
      sod: st.sod, outputPorts: st.outputPorts, keyQueue: st.keyQueue,
    }, [ram.buffer]);
    return;
  }

  // Yield to process any pending messages, then continue immediately
  scheduleTick();
}

// ── Message handler ───────────────────────────────────────────────────────────
const INT_TYPE = { TRAP: 0, RST75: 1, RST65: 2, RST55: 3 };

self.onmessage = function bootstrap({ data }) {
  if (data.cmd !== 'init') return;

  // Switch to the real handler immediately (before async WASM load)
  // so that any messages arriving during load are queued and handled once M is ready.
  self.onmessage = function handle({ data: d }) {
    if (!M) return;
    switch (d.cmd) {
      case 'startWarp':
        jsDBP = new Set(d.snap.dataBps);
        bpMap = new Map(d.snap.breakpoints);
        jsDataWatchHit = -1;
        M._sim_init();
        initFromSnap(d.snap);
        running = true; stopRequested = false;
        throughput.steps = throughput.ms = throughput.mhz = throughput.pendingSteps = 0;
        lastUiMs = 0; wasHaltWaiting = false;
        scheduleTick();
        break;
      case 'stop':
        stopRequested = true;
        break;
      case 'assertInterrupt': {
        const t = INT_TYPE[d.intType];
        if (t !== undefined) M._sim_assert_interrupt(t);
        break;
      }
      case 'deassertInterrupt': {
        const t = INT_TYPE[d.intType];
        if (t !== undefined) M._sim_deassert_interrupt(t);
        break;
      }
      case 'enqueueKeys': {
        const p = writeStr(d.keys);
        M._sim_enqueue_keys(p);
        free_(p);
        break;
      }
      case 'setInputPort':
        M._sim_set_input_port(d.port & 0xFF, d.val & 0xFF);
        break;
    }
  };

  try {
    importScripts(data.baseUrl + 'sim8085.js');
    Sim8085Module().then(mod => { // eslint-disable-line no-undef
      M = mod;
      M._sim_init();
      self.postMessage({ type: 'ready' });
    });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};
