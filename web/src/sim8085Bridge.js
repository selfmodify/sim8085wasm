/**
 * sim8085Bridge.js
 * ─────────────────────────────────────────────────────────────
 * Pure-JS simulation layer that mirrors the C API exactly.
 * Used while Emscripten WASM isn't loaded yet (dev mode / fallback).
 *
 * When the real WASM module is ready, swap Module.ccall for these stubs.
 * For now this is a complete JS reimplementation of the core used
 * directly by React — no WASM dependency needed to develop the UI.
 * ─────────────────────────────────────────────────────────────
 */

import { TSTATES } from './utils.js'

let MAIN_MEMORY = 64 * 1024;
const DEFAULT_IP  = 0x100;

// Status bits
const HALTED       = 0x0400;
const QUIT         = 0x0001;
const SEVERE_ERROR = 0x0002;

// ── State ──────────────────────────────────────────────────────────────
let ram    = new Uint8Array(MAIN_MEMORY);
let regs   = { a:0, b:0, c:0, d:0, e:0, h:0, l:0, flags:0, pc:DEFAULT_IP, sp:0 };
let status = 0;
let breakpoints = new Set();
let dataBPs     = new Set();     // write watchpoints
let dataWatchHit = -1;           // address that triggered last watchpoint (-1 = none)
let leds   = new Array(8).fill(0);
let lastError = '';
let ioIn   = new Uint8Array(256);   // values returned by IN instructions
let ioOut  = new Uint8Array(256);   // values written by OUT instructions
let ioOutTouched = new Set();       // which output ports have been written
let lastSymbols     = {}
let cycles          = 0
let hitcnt          = new Uint32Array(65536)  // profiler: instruction hit counts
let lastProgStart   = DEFAULT_IP
let lastProgEnd     = DEFAULT_IP
let lastPresetAddrs = new Set()

// ── Console output (bytes written to consolePort treated as ASCII stream) ─
let consolePort   = 0x01
let consoleBuf    = ''
const CONSOLE_MAX = 8192

// ── Keyboard input queue (fed by simEnqueueKeys, consumed by syscall C=01H) ─
let keyQueue = []      // array of char codes (0-255)

// ── SID/SOD serial pins ─────────────────────────────────────────────────
let sidValue = 0    // Serial Input Data — bit read by RIM (set externally)
let sodValue = 0    // Serial Output Data — bit written by SIM

// ── Interrupt state ────────────────────────────────────────────────────
let iff      = false   // interrupt enable flip-flop
let iffNext  = false   // EI delay: iff enables after next instruction
let intMask  = 0       // bit0=RST5.5 masked, bit1=RST6.5 masked, bit2=RST7.5 masked
let rst75ff  = false   // RST 7.5 edge latch (set by assert, cleared by SIM b4 or service)
let trapPend = false   // TRAP pending (non-maskable, fires once per assertion)
let intLines = { rst65: false, rst55: false, intr: false, intrVec: 0xFF }

// ── 7-segment encoding ─────────────────────────────────────────────────
const SEG7 = [63,6,91,79,102,109,125,7,127,111,119,124,57,94,121,113];
function numTo7Seg(n) { return SEG7[n & 0xF]; }

// ── Flag helpers ───────────────────────────────────────────────────────
function parity(v) {
  v &= 0xFF;
  v ^= v >> 4; v ^= v >> 2; v ^= v >> 1;
  return (~v) & 1;
}
function setFlags(result, auxCarry, keepCarry) {
  const r8 = result & 0xFF;
  let f = regs.flags;
  f = (f & ~0x80) | (r8 & 0x80);           // S
  f = (f & ~0x40) | (r8 === 0 ? 0x40 : 0); // Z
  f = (f & ~0x10) | (auxCarry ? 0x10 : 0); // AC
  f = (f & ~0x04) | (parity(r8) ? 0x04 : 0); // P
  if (!keepCarry)
    f = (f & ~0x01) | (result > 0xFF || result < 0 ? 0x01 : 0); // CY
  regs.flags = f;
}
function auxCarryAdd(a, b, cy=0) { return ((a & 0xF) + (b & 0xF) + cy) > 0xF; }
function auxCarrySub(a, b, cy=0) { return ((a & 0xF) - (b & 0xF) - cy) < 0; }
function getCarry()    { return regs.flags & 0x01; }
function getZero()     { return (regs.flags >> 6) & 1; }
function getSign()     { return (regs.flags >> 7) & 1; }
function getParity()   { return (regs.flags >> 2) & 1; }
function getAuxCarry() { return (regs.flags >> 4) & 1; }
function getHL() { return (regs.h << 8) | regs.l; }
function getBC() { return (regs.b << 8) | regs.c; }
function getDE() { return (regs.d << 8) | regs.e; }
function setHL(v) { regs.h = (v >> 8) & 0xFF; regs.l = v & 0xFF; }
function setBC(v) { regs.b = (v >> 8) & 0xFF; regs.c = v & 0xFF; }
function setDE(v) { regs.d = (v >> 8) & 0xFF; regs.e = v & 0xFF; }
function memR(a)    { a &= 0xFFFF; return a < MAIN_MEMORY ? ram[a] : 0; }
function memR16(a)  { return memR(a) | (memR((a+1) & 0xFFFF) << 8); }
function memW(a,v)  { a &= 0xFFFF; if (a < MAIN_MEMORY) { ram[a] = v & 0xFF; if (dataBPs.has(a) && dataWatchHit < 0) dataWatchHit = a; } }
function memW16(a,v){ memW(a, v & 0xFF); memW((a+1) & 0xFFFF, (v>>8) & 0xFF); }
function push16(v)  { regs.sp = (regs.sp - 2) & 0xFFFF; memW16(regs.sp, v); }
function pop16()    { const v = memR16(regs.sp); regs.sp = (regs.sp + 2) & 0xFFFF; return v; }

// ── System call (CALL 5) ───────────────────────────────────────────────
function systemCall() {
  const c = regs.c;
  switch(c) {
    case 0x00: break; // reset - nop
    case 0x01: regs.a = keyQueue.length > 0 ? keyQueue.shift() : 0; break; // read key from queue
    case 0x02: { // display digit
      const f = regs.b;
      const v = numTo7Seg(memR(getHL()));
      if (f < 2) leds[f] = v;
      else if (f < 6) leds[f] = v;
      else if (f < 8) leds[f] = v;
      break;
    }
    case 0x03: { // blank
      const b = regs.b;
      if (b === 0) { leds[2]=leds[3]=leds[4]=leds[5]=0x80; }
      else if (b === 1) { leds[6]=leds[7]=0x80; }
      else if (b === 2) { leds[0]=leds[1]=0x80; }
      else { leds.fill(0x80); }
      break;
    }
    case 0x09: case 0x0B: { // scroll
      leds[5]=leds[4]; leds[4]=leds[3]; leds[3]=leds[2];
      leds[2]=leds[7]; leds[7]=leds[6];
      leds[6]=numTo7Seg(regs.d);
      break;
    }
    default: break;
  }
}

// ── One instruction step ───────────────────────────────────────────────
function stepOne() {
  if (status & (HALTED | QUIT | SEVERE_ERROR)) return false;
  const pc = regs.pc;
  const op = memR(pc);
  hitcnt[pc]++;

  cycles += TSTATES[op] || 0;

  // CALL 5 intercept
  if (op === 0xCD && memR16(pc+1) === 0x0005) {
    systemCall();
    regs.pc = (pc + 3) & 0xFFFF;
    return !(status & (HALTED|QUIT|SEVERE_ERROR));
  }

  let inc = 1;
  let r, v, a16, lo, hi;

  switch(op) {
    case 0x00: inc=1; break; // NOP
    case 0x76: regs.pc = (pc + 1) & 0xFFFF; status |= HALTED; return false; // HLT — halt-wait; resumes on interrupt

    // ── MOV r,r ──────────────────────────────────────────────────────
    case 0x40: case 0x49: case 0x52: case 0x5B: case 0x64: case 0x6D: case 0x7F:
      break; // MOV r,r (same register) - NOP equivalent
    case 0x41: regs.b=regs.c; break;
    case 0x42: regs.b=regs.d; break;
    case 0x43: regs.b=regs.e; break;
    case 0x44: regs.b=regs.h; break;
    case 0x45: regs.b=regs.l; break;
    case 0x46: regs.b=memR(getHL()); break;
    case 0x47: regs.b=regs.a; break;
    case 0x48: regs.c=regs.b; break;
    case 0x4A: regs.c=regs.d; break;
    case 0x4B: regs.c=regs.e; break;
    case 0x4C: regs.c=regs.h; break;
    case 0x4D: regs.c=regs.l; break;
    case 0x4E: regs.c=memR(getHL()); break;
    case 0x4F: regs.c=regs.a; break;
    case 0x50: regs.d=regs.b; break;
    case 0x51: regs.d=regs.c; break;
    case 0x53: regs.d=regs.e; break;
    case 0x54: regs.d=regs.h; break;
    case 0x55: regs.d=regs.l; break;
    case 0x56: regs.d=memR(getHL()); break;
    case 0x57: regs.d=regs.a; break;
    case 0x58: regs.e=regs.b; break;
    case 0x59: regs.e=regs.c; break;
    case 0x5A: regs.e=regs.d; break;
    case 0x5C: regs.e=regs.h; break;
    case 0x5D: regs.e=regs.l; break;
    case 0x5E: regs.e=memR(getHL()); break;
    case 0x5F: regs.e=regs.a; break;
    case 0x60: regs.h=regs.b; break;
    case 0x61: regs.h=regs.c; break;
    case 0x62: regs.h=regs.d; break;
    case 0x63: regs.h=regs.e; break;
    case 0x65: regs.h=regs.l; break;
    case 0x66: regs.h=memR(getHL()); break;
    case 0x67: regs.h=regs.a; break;
    case 0x68: regs.l=regs.b; break;
    case 0x69: regs.l=regs.c; break;
    case 0x6A: regs.l=regs.d; break;
    case 0x6B: regs.l=regs.e; break;
    case 0x6C: regs.l=regs.h; break;
    case 0x6E: regs.l=memR(getHL()); break;
    case 0x6F: regs.l=regs.a; break;
    case 0x70: memW(getHL(),regs.b); break;
    case 0x71: memW(getHL(),regs.c); break;
    case 0x72: memW(getHL(),regs.d); break;
    case 0x73: memW(getHL(),regs.e); break;
    case 0x74: memW(getHL(),regs.h); break;
    case 0x75: memW(getHL(),regs.l); break;
    case 0x77: memW(getHL(),regs.a); break;
    case 0x78: regs.a=regs.b; break;
    case 0x79: regs.a=regs.c; break;
    case 0x7A: regs.a=regs.d; break;
    case 0x7B: regs.a=regs.e; break;
    case 0x7C: regs.a=regs.h; break;
    case 0x7D: regs.a=regs.l; break;
    case 0x7E: regs.a=memR(getHL()); break;

    // ── MVI ──────────────────────────────────────────────────────────
    case 0x06: regs.b=memR(pc+1); inc=2; break;
    case 0x0E: regs.c=memR(pc+1); inc=2; break;
    case 0x16: regs.d=memR(pc+1); inc=2; break;
    case 0x1E: regs.e=memR(pc+1); inc=2; break;
    case 0x26: regs.h=memR(pc+1); inc=2; break;
    case 0x2E: regs.l=memR(pc+1); inc=2; break;
    case 0x36: memW(getHL(),memR(pc+1)); inc=2; break;
    case 0x3E: regs.a=memR(pc+1); inc=2; break;

    // ── LXI ──────────────────────────────────────────────────────────
    case 0x01: setBC(memR16(pc+1)); inc=3; break;
    case 0x11: setDE(memR16(pc+1)); inc=3; break;
    case 0x21: setHL(memR16(pc+1)); inc=3; break;
    case 0x31: regs.sp=memR16(pc+1); inc=3; break;

    // ── LDA/STA/LHLD/SHLD ────────────────────────────────────────────
    case 0x3A: regs.a=memR(memR16(pc+1)); inc=3; break;
    case 0x32: memW(memR16(pc+1),regs.a); inc=3; break;
    case 0x2A: a16=memR16(pc+1); regs.l=memR(a16); regs.h=memR(a16+1); inc=3; break;
    case 0x22: a16=memR16(pc+1); memW(a16,regs.l); memW(a16+1,regs.h); inc=3; break;

    // ── LDAX/STAX ─────────────────────────────────────────────────────
    case 0x0A: regs.a=memR(getBC()); break;
    case 0x1A: regs.a=memR(getDE()); break;
    case 0x02: memW(getBC(),regs.a); break;
    case 0x12: memW(getDE(),regs.a); break;

    // ── XCHG/XTHL/SPHL/PCHL ──────────────────────────────────────────
    case 0xEB: { const th=regs.h,tl=regs.l; regs.h=regs.d; regs.d=th; regs.l=regs.e; regs.e=tl; break; }
    case 0xE3: { lo=memR(regs.sp); hi=memR(regs.sp+1); memW(regs.sp,regs.l); memW(regs.sp+1,regs.h); regs.l=lo; regs.h=hi; break; }
    case 0xF9: regs.sp=getHL(); break;
    case 0xE9: regs.pc=getHL(); return !(status & (HALTED|QUIT));

    // ── PUSH/POP ──────────────────────────────────────────────────────
    case 0xC5: push16(getBC()); break;
    case 0xD5: push16(getDE()); break;
    case 0xE5: push16(getHL()); break;
    case 0xF5: push16((regs.a<<8)|regs.flags); break;
    case 0xC1: setBC(pop16()); break;
    case 0xD1: setDE(pop16()); break;
    case 0xE1: setHL(pop16()); break;
    case 0xF1: { v=pop16(); regs.flags=v&0xFF; regs.a=(v>>8)&0xFF; break; }

    // ── ADD ───────────────────────────────────────────────────────────
    case 0x80: r=regs.a+regs.b; setFlags(r,auxCarryAdd(regs.a,regs.b),false); regs.a=r&0xFF; break;
    case 0x81: r=regs.a+regs.c; setFlags(r,auxCarryAdd(regs.a,regs.c),false); regs.a=r&0xFF; break;
    case 0x82: r=regs.a+regs.d; setFlags(r,auxCarryAdd(regs.a,regs.d),false); regs.a=r&0xFF; break;
    case 0x83: r=regs.a+regs.e; setFlags(r,auxCarryAdd(regs.a,regs.e),false); regs.a=r&0xFF; break;
    case 0x84: r=regs.a+regs.h; setFlags(r,auxCarryAdd(regs.a,regs.h),false); regs.a=r&0xFF; break;
    case 0x85: r=regs.a+regs.l; setFlags(r,auxCarryAdd(regs.a,regs.l),false); regs.a=r&0xFF; break;
    case 0x86: v=memR(getHL()); r=regs.a+v; setFlags(r,auxCarryAdd(regs.a,v),false); regs.a=r&0xFF; break;
    case 0x87: r=regs.a*2; setFlags(r,auxCarryAdd(regs.a,regs.a),false); regs.a=r&0xFF; break;
    case 0xC6: v=memR(pc+1); r=regs.a+v; setFlags(r,auxCarryAdd(regs.a,v),false); regs.a=r&0xFF; inc=2; break;

    // ── ADC ───────────────────────────────────────────────────────────
    case 0x88: { const v=regs.b, c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x89: { const v=regs.c, c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x8A: { const v=regs.d, c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x8B: { const v=regs.e, c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x8C: { const v=regs.h, c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x8D: { const v=regs.l, c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x8E: { const v=memR(getHL()), c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x8F: { const v=regs.a, c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0xCE: { const v=memR(pc+1), c=getCarry(); r=regs.a+v+c; setFlags(r,auxCarryAdd(regs.a,v,c),false); regs.a=r&0xFF; inc=2; break; }

    // ── SUB ───────────────────────────────────────────────────────────
    case 0x90: r=regs.a-regs.b; setFlags(r,auxCarrySub(regs.a,regs.b),false); regs.a=r&0xFF; break;
    case 0x91: r=regs.a-regs.c; setFlags(r,auxCarrySub(regs.a,regs.c),false); regs.a=r&0xFF; break;
    case 0x92: r=regs.a-regs.d; setFlags(r,auxCarrySub(regs.a,regs.d),false); regs.a=r&0xFF; break;
    case 0x93: r=regs.a-regs.e; setFlags(r,auxCarrySub(regs.a,regs.e),false); regs.a=r&0xFF; break;
    case 0x94: r=regs.a-regs.h; setFlags(r,auxCarrySub(regs.a,regs.h),false); regs.a=r&0xFF; break;
    case 0x95: r=regs.a-regs.l; setFlags(r,auxCarrySub(regs.a,regs.l),false); regs.a=r&0xFF; break;
    case 0x96: v=memR(getHL()); r=regs.a-v; setFlags(r,auxCarrySub(regs.a,v),false); regs.a=r&0xFF; break;
    case 0x97: setFlags(0,false,false); regs.a=0; break; // SUB A
    case 0xD6: v=memR(pc+1); r=regs.a-v; setFlags(r,auxCarrySub(regs.a,v),false); regs.a=r&0xFF; inc=2; break;

    // ── SBB ───────────────────────────────────────────────────────────
    case 0x98: { const v=regs.b, c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x99: { const v=regs.c, c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x9A: { const v=regs.d, c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x9B: { const v=regs.e, c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x9C: { const v=regs.h, c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x9D: { const v=regs.l, c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x9E: { const v=memR(getHL()), c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0x9F: { const v=regs.a, c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; break; }
    case 0xDE: { const v=memR(pc+1), c=getCarry(); r=regs.a-v-c; setFlags(r,auxCarrySub(regs.a,v,c),false); regs.a=r&0xFF; inc=2; break; }

    // ── INR/DCR ───────────────────────────────────────────────────────
    case 0x04: r=regs.b+1; { const ac=auxCarryAdd(regs.b,1); regs.b=r&0xFF; setFlags(r,ac,true); } break;
    case 0x0C: r=regs.c+1; { const ac=auxCarryAdd(regs.c,1); regs.c=r&0xFF; setFlags(r,ac,true); } break;
    case 0x14: r=regs.d+1; { const ac=auxCarryAdd(regs.d,1); regs.d=r&0xFF; setFlags(r,ac,true); } break;
    case 0x1C: r=regs.e+1; { const ac=auxCarryAdd(regs.e,1); regs.e=r&0xFF; setFlags(r,ac,true); } break;
    case 0x24: r=regs.h+1; { const ac=auxCarryAdd(regs.h,1); regs.h=r&0xFF; setFlags(r,ac,true); } break;
    case 0x2C: r=regs.l+1; { const ac=auxCarryAdd(regs.l,1); regs.l=r&0xFF; setFlags(r,ac,true); } break;
    case 0x34: v=memR(getHL()); r=v+1; { const ac=auxCarryAdd(v,1); memW(getHL(),r&0xFF); setFlags(r,ac,true); } break;
    case 0x3C: r=regs.a+1; { const ac=auxCarryAdd(regs.a,1); regs.a=r&0xFF; setFlags(r,ac,true); } break;
    case 0x05: r=regs.b-1; { const ac=auxCarrySub(regs.b,1); regs.b=r&0xFF; setFlags(r,ac,true); } break;
    case 0x0D: r=regs.c-1; { const ac=auxCarrySub(regs.c,1); regs.c=r&0xFF; setFlags(r,ac,true); } break;
    case 0x15: r=regs.d-1; { const ac=auxCarrySub(regs.d,1); regs.d=r&0xFF; setFlags(r,ac,true); } break;
    case 0x1D: r=regs.e-1; { const ac=auxCarrySub(regs.e,1); regs.e=r&0xFF; setFlags(r,ac,true); } break;
    case 0x25: r=regs.h-1; { const ac=auxCarrySub(regs.h,1); regs.h=r&0xFF; setFlags(r,ac,true); } break;
    case 0x2D: r=regs.l-1; { const ac=auxCarrySub(regs.l,1); regs.l=r&0xFF; setFlags(r,ac,true); } break;
    case 0x35: v=memR(getHL()); r=v-1; { const ac=auxCarrySub(v,1); memW(getHL(),r&0xFF); setFlags(r,ac,true); } break;
    case 0x3D: r=regs.a-1; { const ac=auxCarrySub(regs.a,1); regs.a=r&0xFF; setFlags(r,ac,true); } break;

    // ── INX/DCX ───────────────────────────────────────────────────────
    case 0x03: setBC((getBC()+1)&0xFFFF); break;
    case 0x13: setDE((getDE()+1)&0xFFFF); break;
    case 0x23: setHL((getHL()+1)&0xFFFF); break;
    case 0x33: regs.sp=(regs.sp+1)&0xFFFF; break;
    case 0x0B: setBC((getBC()-1)&0xFFFF); break;
    case 0x1B: setDE((getDE()-1)&0xFFFF); break;
    case 0x2B: setHL((getHL()-1)&0xFFFF); break;
    case 0x3B: regs.sp=(regs.sp-1)&0xFFFF; break;

    // ── DAD ───────────────────────────────────────────────────────────
    case 0x09: r=getHL()+getBC(); regs.flags=(regs.flags&~1)|(r>0xFFFF?1:0); setHL(r&0xFFFF); break;
    case 0x19: r=getHL()+getDE(); regs.flags=(regs.flags&~1)|(r>0xFFFF?1:0); setHL(r&0xFFFF); break;
    case 0x29: r=getHL()*2; regs.flags=(regs.flags&~1)|(r>0xFFFF?1:0); setHL(r&0xFFFF); break;
    case 0x39: r=getHL()+regs.sp; regs.flags=(regs.flags&~1)|(r>0xFFFF?1:0); setHL(r&0xFFFF); break;

    // ── DAA ───────────────────────────────────────────────────────────
    case 0x27: {
      let a=regs.a, corr=0, cy=getCarry(), ac=getAuxCarry();
      if (ac || (a & 0xF) > 9) corr |= 0x06;
      if (cy || a > 0x99) { corr |= 0x60; cy = 1; }
      let res = a + corr;
      let newAC = ((a & 0x0F) + (corr & 0x0F)) > 0x0F;
      regs.flags=(regs.flags&~1)|cy;
      setFlags(res, newAC, true);
      regs.a = res & 0xFF;
      break;
    }

    // ── ANA/ORA/XRA/CMP ───────────────────────────────────────────────
    case 0xA0: { const ac=((regs.a|regs.b)&0x08)!==0; regs.a&=regs.b; setFlags(regs.a,ac,false); regs.flags&=~1; break; }
    case 0xA1: { const ac=((regs.a|regs.c)&0x08)!==0; regs.a&=regs.c; setFlags(regs.a,ac,false); regs.flags&=~1; break; }
    case 0xA2: { const ac=((regs.a|regs.d)&0x08)!==0; regs.a&=regs.d; setFlags(regs.a,ac,false); regs.flags&=~1; break; }
    case 0xA3: { const ac=((regs.a|regs.e)&0x08)!==0; regs.a&=regs.e; setFlags(regs.a,ac,false); regs.flags&=~1; break; }
    case 0xA4: { const ac=((regs.a|regs.h)&0x08)!==0; regs.a&=regs.h; setFlags(regs.a,ac,false); regs.flags&=~1; break; }
    case 0xA5: { const ac=((regs.a|regs.l)&0x08)!==0; regs.a&=regs.l; setFlags(regs.a,ac,false); regs.flags&=~1; break; }
    case 0xA6: { const v=memR(getHL()), ac=((regs.a|v)&0x08)!==0; regs.a&=v; setFlags(regs.a,ac,false); regs.flags&=~1; break; }
    case 0xA7: { const ac=((regs.a|regs.a)&0x08)!==0; setFlags(regs.a,ac,false); regs.flags&=~1; break; }
    case 0xE6: { const v=memR(pc+1), ac=((regs.a|v)&0x08)!==0; regs.a&=v; setFlags(regs.a,ac,false); regs.flags&=~1; inc=2; break; }
    case 0xB0: regs.a|=regs.b; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xB1: regs.a|=regs.c; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xB2: regs.a|=regs.d; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xB3: regs.a|=regs.e; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xB4: regs.a|=regs.h; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xB5: regs.a|=regs.l; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xB6: regs.a|=memR(getHL()); setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xB7: setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xF6: regs.a|=memR(pc+1); setFlags(regs.a,false,false); regs.flags&=~0x11; inc=2; break;
    case 0xA8: regs.a^=regs.b; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xA9: regs.a^=regs.c; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xAA: regs.a^=regs.d; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xAB: regs.a^=regs.e; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xAC: regs.a^=regs.h; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xAD: regs.a^=regs.l; setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xAE: regs.a^=memR(getHL()); setFlags(regs.a,false,false); regs.flags&=~0x11; break;
    case 0xAF: regs.a=0; setFlags(0,false,false); regs.flags&=~0x11; break;
    case 0xEE: regs.a^=memR(pc+1); setFlags(regs.a,false,false); regs.flags&=~0x11; inc=2; break;
    case 0xB8: r=regs.a-regs.b; setFlags(r,auxCarrySub(regs.a,regs.b),false); break;
    case 0xB9: r=regs.a-regs.c; setFlags(r,auxCarrySub(regs.a,regs.c),false); break;
    case 0xBA: r=regs.a-regs.d; setFlags(r,auxCarrySub(regs.a,regs.d),false); break;
    case 0xBB: r=regs.a-regs.e; setFlags(r,auxCarrySub(regs.a,regs.e),false); break;
    case 0xBC: r=regs.a-regs.h; setFlags(r,auxCarrySub(regs.a,regs.h),false); break;
    case 0xBD: r=regs.a-regs.l; setFlags(r,auxCarrySub(regs.a,regs.l),false); break;
    case 0xBE: v=memR(getHL()); r=regs.a-v; setFlags(r,auxCarrySub(regs.a,v),false); break;
    case 0xBF: setFlags(0,false,false); regs.flags&=~1; break;
    case 0xFE: v=memR(pc+1); r=regs.a-v; setFlags(r,auxCarrySub(regs.a,v),false); inc=2; break;

    // ── CMA/CMC/STC ───────────────────────────────────────────────────
    case 0x2F: regs.a=(~regs.a)&0xFF; break;
    case 0x3F: regs.flags^=1; break;
    case 0x37: regs.flags|=1; break;

    // ── Rotate ────────────────────────────────────────────────────────
    case 0x07: { const b7=(regs.a>>7)&1; regs.a=((regs.a<<1)|b7)&0xFF; regs.flags=(regs.flags&~1)|b7; break; }
    case 0x0F: { const b0=regs.a&1; regs.a=((regs.a>>1)|(b0<<7))&0xFF; regs.flags=(regs.flags&~1)|b0; break; }
    case 0x17: { const b7=(regs.a>>7)&1,cy=getCarry(); regs.a=((regs.a<<1)|cy)&0xFF; regs.flags=(regs.flags&~1)|b7; break; }
    case 0x1F: { const b0=regs.a&1,cy=getCarry(); regs.a=((regs.a>>1)|(cy<<7))&0xFF; regs.flags=(regs.flags&~1)|b0; break; }

    // ── Jumps ─────────────────────────────────────────────────────────
    case 0xC3: regs.pc=memR16(pc+1); return !(status&(HALTED|QUIT));
    case 0xC2: if(!getZero())  { regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xCA: if(getZero())   { regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xD2: if(!getCarry()) { regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xDA: if(getCarry())  { regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xE2: if(!getParity()){ regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xEA: if(getParity()) { regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xF2: if(!getSign())  { regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xFA: if(getSign())   { regs.pc=memR16(pc+1); return true; } inc=3; break;

    // ── Calls ─────────────────────────────────────────────────────────
    case 0xCD: push16(pc+3); regs.pc=memR16(pc+1); return true;
    case 0xC4: if(!getZero())  { push16(pc+3); regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xCC: if(getZero())   { push16(pc+3); regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xD4: if(!getCarry()) { push16(pc+3); regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xDC: if(getCarry())  { push16(pc+3); regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xE4: if(!getParity()){ push16(pc+3); regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xEC: if(getParity()) { push16(pc+3); regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xF4: if(!getSign())  { push16(pc+3); regs.pc=memR16(pc+1); return true; } inc=3; break;
    case 0xFC: if(getSign())   { push16(pc+3); regs.pc=memR16(pc+1); return true; } inc=3; break;

    // ── Returns ───────────────────────────────────────────────────────
    case 0xC9: regs.pc=pop16(); return true;
    case 0xC0: if(!getZero())  { regs.pc=pop16(); return true; } break;
    case 0xC8: if(getZero())   { regs.pc=pop16(); return true; } break;
    case 0xD0: if(!getCarry()) { regs.pc=pop16(); return true; } break;
    case 0xD8: if(getCarry())  { regs.pc=pop16(); return true; } break;
    case 0xE0: if(!getParity()){ regs.pc=pop16(); return true; } break;
    case 0xE8: if(getParity()) { regs.pc=pop16(); return true; } break;
    case 0xF0: if(!getSign())  { regs.pc=pop16(); return true; } break;
    case 0xF8: if(getSign())   { regs.pc=pop16(); return true; } break;

    // ── RST ───────────────────────────────────────────────────────────
    case 0xC7: push16(pc+1); regs.pc=0x00; return true;
    case 0xCF: push16(pc+1); regs.pc=0x08; return true;
    case 0xD7: push16(pc+1); regs.pc=0x10; return true;
    case 0xDF: push16(pc+1); regs.pc=0x18; return true;
    case 0xE7: push16(pc+1); regs.pc=0x20; return true;
    case 0xEF: push16(pc+1); regs.pc=0x28; return true;
    case 0xF7: push16(pc+1); regs.pc=0x30; return true;
    case 0xFF: push16(pc+1); regs.pc=0x38; return true;

    // ── EI/DI/RIM/SIM/IN/OUT ─────────────────────────────────────────
    case 0xFB: iffNext = true; break;                         // EI
    case 0xF3: iff = false; iffNext = false; break;           // DI
    case 0x30: {                                              // SIM
      if (regs.a & 0x08) intMask = regs.a & 0x07             // set masks if MSE bit set
      if (regs.a & 0x10) rst75ff = false                     // reset RST 7.5 latch
      if (regs.a & 0x40) sodValue = (regs.a >> 7) & 1       // SOD bit if SODE set
      break
    }
    case 0x20: {                                              // RIM
      regs.a = (intMask & 0x07)           |
               (iff            ? 0x08 : 0) |
               (intLines.rst55 ? 0x10 : 0) |
               (intLines.rst65 ? 0x20 : 0) |
               (rst75ff        ? 0x40 : 0) |
               (sidValue       ? 0x80 : 0)
      break
    }
    case 0xDB: { const port = memR(pc+1); regs.a = ioIn[port]; inc=2; break; } // IN port
    case 0xD3: { const port = memR(pc+1); ioOut[port] = regs.a; ioOutTouched.add(port); inc=2;
      if (port === consolePort) {
        const b = regs.a
        if (b === 0x0A) consoleBuf += '\n'
        else if (b === 0x0D) { /* ignore CR */ }
        else if (b === 0x08 && consoleBuf.length) consoleBuf = consoleBuf.slice(0, -1)
        else if (b >= 0x20 && b <= 0x7E) consoleBuf += String.fromCharCode(b)
        if (consoleBuf.length > CONSOLE_MAX) consoleBuf = consoleBuf.slice(-CONSOLE_MAX)
      }
      break; } // OUT port

    // ── ASSERT (0xDD — undefined opcode repurposed for testing) ──────
    case 0xDD: {
      const sub = memR(pc+1);
      const REG8_N = ['B','C','D','E','H','L','M','A'];
      const REG8_V = [regs.b,regs.c,regs.d,regs.e,regs.h,regs.l,memR(getHL()),regs.a];
      const FLAG_N = ['CY','Z','S','P','AC'];
      const FLAG_V = [getCarry(),getZero(),getSign(),getParity(),getAuxCarry()];
      const PAIR_N = ['BC','DE','HL','SP','PC'];
      const PAIR_V = [getBC(),getDE(),getHL(),regs.sp,pc];
      let fail=false, msg='';
      if (sub <= 0x07) {                           // 8-bit register
        const exp=memR(pc+2), act=REG8_V[sub]; inc=3;
        if (act!==exp){fail=true; msg=`${REG8_N[sub]}=${h(exp)}H got ${h(act)}H`;}
      } else if (sub>=0x10 && sub<=0x14) {         // flag
        const fi=sub-0x10, exp=memR(pc+2)&1, act=FLAG_V[fi]; inc=3;
        if (act!==exp){fail=true; msg=`${FLAG_N[fi]}=${exp} got ${act}`;}
      } else if (sub>=0x20 && sub<=0x24) {         // 16-bit pair/register
        const pi=sub-0x20, exp=memR16(pc+2); inc=4;
        const act=pi===4?regs.pc:PAIR_V[pi]; // PC assertion: current PC = pc (before this instruction)
        if (act!==exp){fail=true; msg=`${PAIR_N[pi]}=${h(exp,4)}H got ${h(act,4)}H`;}
      } else if (sub===0x30) {                     // memory byte
        const addr=memR16(pc+2), exp=memR(pc+4), act=memR(addr); inc=5;
        if (act!==exp){fail=true; msg=`mem[${h(addr,4)}H]=${h(exp)}H got ${h(act)}H`;}
      } else { inc=2; }                            // unknown sub-type, skip 2 bytes
      if (fail) { lastError=`[${h(pc,4)}H] Assertion failed: ${msg}`; status|=SEVERE_ERROR; }
      break;
    }

    default: break; // invalid - skip
  }

  cycles += TSTATES[op]
  regs.pc = (pc + inc) & 0xFFFF;
  return !(status & (HALTED|QUIT|SEVERE_ERROR));
}

// ── Assembler (tokenizer + recursive-descent) ──────────────────────────
function h(n,w=2) { return n.toString(16).toUpperCase().padStart(w,'0'); }

function assemble(source) {
  // Reset machine
  ram.fill(0);
  regs = { a:0, b:0, c:0, d:0, e:0, h:0, l:0, flags:0, pc:DEFAULT_IP, sp:0 };
  status = 0;
  lastError = '';
  let ptr = DEFAULT_IP;
  let entryIP = DEFAULT_IP;

  const lines = source.split('\n');
  const labels = {};
  const patches = []; // {addr, label, line}
  const errors = [];
  const presetAddrs = new Set();

  // Tokenizer
  function tokenize(line) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === ';') break;
      if (/\s/.test(line[i])) { i++; continue; }
      if (line[i] === ',') { tokens.push({type:'comma'}); i++; continue; }
      if (line[i] === ':') { tokens.push({type:'colon'}); i++; continue; }
      if (line[i] === '"' || line[i] === "'") {
        const q = line[i++]; let s = '';
        while (i < line.length && line[i] !== q) s += line[i++];
        if (line[i] === q) i++;
        tokens.push({type:'str', val:s}); continue;
      }
      let j = i;
      while (j < line.length && !/[\s,;:]/.test(line[j])) j++;
      const tok = line.slice(i,j);
      i = j;
      // Determine if number: starts with digit OR ends with H/#
      const upper = tok.toUpperCase();
      let num = null;
      if (/^\d/.test(tok)) {
        // decimal or hex with suffix
        if (upper.endsWith('H')) num = parseInt(upper.slice(0,-1),16);
        else if (upper.endsWith('#')) num = parseInt(upper.slice(0,-1),16);
        else if (upper.endsWith('D')) num = parseInt(upper.slice(0,-1),10);
        else if (upper.endsWith('B')) num = parseInt(upper.slice(0,-1),2);
        else num = parseInt(upper,16); // default hex per original
        tokens.push({type:'num', val: isNaN(num)?0:num, raw:tok});
      } else if (/^[0-9A-Fa-f]+[HhBb#Dd]$/.test(tok) && /^[A-Fa-f]/.test(tok)) {
        // e.g. "ffH"
        if (upper.endsWith('H')||upper.endsWith('#')) num = parseInt(upper.slice(0,-1),16);
        else if (upper.endsWith('B')) num = parseInt(upper.slice(0,-1),2);
        else if (upper.endsWith('D')) num = parseInt(upper.slice(0,-1),10);
        else num = parseInt(upper,16);
        if (!isNaN(num)) {
          tokens.push({type:'num', val: num, raw:tok});
        } else {
          tokens.push({type:'id', val:upper, raw:tok});
        }
      } else {
        tokens.push({type:'id', val:upper, raw:tok});
      }
    }
    return tokens;
  }

  function emit(b) { ram[ptr++] = b & 0xFF; }
  function emit16(w) { emit(w & 0xFF); emit((w>>8) & 0xFF); }

  function parseNum(tok, lineNo) {
    if (!tok) return null;
    if (tok.type === 'num') return tok.val;
    if (tok.type === 'id') {
      // Try as hex
      const n = parseInt(tok.val, 16);
      if (!isNaN(n) && /^[0-9A-F]+$/.test(tok.val)) return n;
      return tok; // it's a label reference
    }
    return null;
  }

  // Pass 1 + 2 combined (labels resolved via patches)
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo].trim();
    if (!raw || raw.startsWith(';')) continue;
    const toks = tokenize(raw);
    if (!toks.length) continue;

    let ti = 0;
    const peek = () => toks[ti];
    const next = () => toks[ti++];
    const expect = (type) => { const t=next(); if(t?.type!==type) errors.push(`Line ${lineNo+1}: expected ${type}`); return t; };

    // Label?
    if (toks[ti]?.type==='id' && toks[ti+1]?.type==='colon') {
      labels[toks[ti].val] = ptr;
      ti += 2;
      if (ti >= toks.length) continue;
    }

    // EQU: NAME EQU value  (no colon — identifier followed immediately by EQU)
    if (toks[ti]?.type==='id' && toks[ti+1]?.type==='id' && toks[ti+1].val==='EQU') {
      const name = toks[ti].val; ti += 2;
      const valTok = next();
      const n = parseNum(valTok, lineNo);
      if (typeof n === 'object' && n.val && labels[n.val] !== undefined) {
        labels[name] = labels[n.val];
      } else {
        labels[name] = typeof n === 'number' ? n : 0;
      }
      continue;
    }

    if (!peek()) continue;
    const mnem = next().val;

    // Directives
    if (mnem==='ORG'||mnem==='KICKOFF') {
      const n = parseNum(next(), lineNo);
      const addr = (typeof n==='number') ? n : 0;
      if (mnem==='ORG') ptr = addr;
      else { entryIP = addr; regs.pc = addr; }
      continue;
    }
    if (mnem==='SETBYTE') {
      const adrTok = next(); expect('comma'); const valTok = next();
      const a = typeof parseNum(adrTok)!=='number' ? parseInt(adrTok.val,16) : parseNum(adrTok);
      const v = parseNum(valTok, lineNo);
      if (typeof v==='number') { ram[a & 0xFFFF] = v & 0xFF; presetAddrs.add(a & 0xFFFF); }
      continue;
    }
    if (mnem==='SETWORD') {
      const adrTok = next(); expect('comma'); const valTok = next();
      const a = typeof parseNum(adrTok)!=='number' ? parseInt(adrTok.val,16) : parseNum(adrTok);
      const v = parseNum(valTok, lineNo);
      if (typeof v==='number') { ram[a]=v&0xFF; ram[a+1]=(v>>8)&0xFF; presetAddrs.add(a&0xFFFF); presetAddrs.add((a+1)&0xFFFF); }
      continue;
    }
    if (mnem==='DB') {
      // DB val [, val ...]  — val may be number, hex, char literal '?', or "string"
      const emitDbVal = (tok) => {
        if (!tok) { errors.push(`Line ${lineNo+1}: DB missing value`); return; }
        if (tok.type === 'str') { for (const ch of tok.val) { ram[ptr++] = ch.charCodeAt(0) & 0xFF; } }
        else { 
          const n = parseNum(tok, lineNo); 
          if (typeof n === 'number') {
            ram[ptr++] = n & 0xFF;
          } else if (typeof n === 'object' && n.val) {
            patches.push({ addr: ptr, label: n.val, lineNo, size: 1 });
            ram[ptr++] = 0;
          } else {
            ram[ptr++] = 0;
          }
        }
      };
      emitDbVal(next());
      while (toks[ti]?.type === 'comma') { ti++; emitDbVal(next()); }
      continue;
    }
    if (mnem==='DW') {
      const emitDwVal = (tok) => {
        if (!tok) { errors.push(`Line ${lineNo+1}: DW missing value`); return; }
        const n = parseNum(tok, lineNo);
        if (typeof n === 'number') {
          ram[ptr++] = n & 0xFF;
          ram[ptr++] = (n >> 8) & 0xFF;
        } else if (typeof n === 'object' && n.val) {
          patches.push({ addr: ptr, label: n.val, lineNo, size: 2 });
          ram[ptr++] = 0;
          ram[ptr++] = 0;
        } else {
          ram[ptr++] = 0;
          ram[ptr++] = 0;
        }
      };
      emitDwVal(next());
      while (toks[ti]?.type === 'comma') { ti++; emitDwVal(next()); }
      continue;
    }
    if (mnem==='DS') {
      // DS count — reserve count bytes (fill with 0)
      const n = parseNum(next(), lineNo);
      const count = typeof n==='number' ? n : 0;
      for (let i = 0; i < count; i++) ram[ptr++] = 0;
      continue;
    }

    // Registers
    const REGS = {B:0,C:1,D:2,E:3,H:4,L:5,M:6,A:7,SP:8,PSW:11};
    function getReg() {
      const t = next();
      if (!t) return -1;
      return REGS[t.val] ?? -1;
    }
    function getImm8() {
      const t = next();
      if (!t) return 0;
      const n = parseNum(t, lineNo);
      if (typeof n === 'number') return n & 0xFF;
      // label → patch with 0 for now
      return 0;
    }
    function getImm16() {
      const t = next();
      if (!t) return 0;
      const n = parseNum(t, lineNo);
      if (typeof n === 'number') return n & 0xFFFF;
      if (typeof n === 'object' && n.val) {
        patches.push({addr: ptr, label: n.val, lineNo});
        return 0;
      }
      return 0;
    }
    function getAddr() { return getImm16(); }

    function emitJmp(op) {
      const t = next();
      const n = parseNum(t, lineNo);
      emit(op);
      if (typeof n === 'number') { emit16(n); }
      else if (t?.type==='id') { patches.push({addr:ptr, label:t.val, lineNo}); emit16(0); }
      else emit16(0);
    }

    switch(mnem) {
      // MOV
      case 'MOV': { const r1=getReg(); expect('comma'); const r2=getReg(); emit(0x40|(r1<<3)|r2); break; }
      // MVI
      case 'MVI': { const r=getReg(); expect('comma'); const v=getImm8(); emit(0x06|(r<<3)); emit(v); break; }
      // LXI
      case 'LXI': {
        const r=getReg(); expect('comma'); const v=getImm16();
        const op = {8:0x31,0:0x01,2:0x11,4:0x21}[r] ?? 0x01;
        emit(op); emit16(v); break;
      }
      case 'LDA': { emit(0x3A); emit16(getAddr()); break; }
      case 'STA': { emit(0x32); emit16(getAddr()); break; }
      case 'LHLD': { emit(0x2A); emit16(getAddr()); break; }
      case 'SHLD': { emit(0x22); emit16(getAddr()); break; }
      case 'LDAX': { const r=getReg(); emit(r===0?0x0A:0x1A); break; }
      case 'STAX': { const r=getReg(); emit(r===0?0x02:0x12); break; }
      case 'XCHG': emit(0xEB); break;
      case 'XTHL': emit(0xE3); break;
      case 'SPHL': emit(0xF9); break;
      case 'PCHL': emit(0xE9); break;
      case 'PUSH': { const r=getReg(); const idx={0:0,2:1,4:2,11:3}[r]??0; emit(0xC5|(idx<<4)); break; }
      case 'POP':  { const r=getReg(); const idx={0:0,2:1,4:2,11:3}[r]??0; emit(0xC1|(idx<<4)); break; }
      case 'ADD': { const r=getReg(); emit(0x80|r); break; }
      case 'ADC': { const r=getReg(); emit(0x88|r); break; }
      case 'SUB': { const r=getReg(); emit(0x90|r); break; }
      case 'SBB': { const r=getReg(); emit(0x98|r); break; }
      case 'ANA': { const r=getReg(); emit(0xA0|r); break; }
      case 'XRA': { const r=getReg(); emit(0xA8|r); break; }
      case 'ORA': { const r=getReg(); emit(0xB0|r); break; }
      case 'CMP': { const r=getReg(); emit(0xB8|r); break; }
      case 'ADI': { emit(0xC6); emit(getImm8()); break; }
      case 'ACI': { emit(0xCE); emit(getImm8()); break; }
      case 'SUI': { emit(0xD6); emit(getImm8()); break; }
      case 'SBI': { emit(0xDE); emit(getImm8()); break; }
      case 'ANI': { emit(0xE6); emit(getImm8()); break; }
      case 'XRI': { emit(0xEE); emit(getImm8()); break; }
      case 'ORI': { emit(0xF6); emit(getImm8()); break; }
      case 'CPI': { emit(0xFE); emit(getImm8()); break; }
      case 'INR': { const r=getReg(); emit(0x04|(r<<3)); break; }
      case 'DCR': { const r=getReg(); emit(0x05|(r<<3)); break; }
      case 'INX': { const r=getReg(); emit([0x03,0,0x13,0,0x23,0,0,0,0x33][r]??0x03); break; }
      case 'DCX': { const r=getReg(); emit([0x0B,0,0x1B,0,0x2B,0,0,0,0x3B][r]??0x0B); break; }
      case 'DAD': { const r=getReg(); emit([0x09,0,0x19,0,0x29,0,0,0,0x39][r]??0x09); break; }
      case 'DAA': emit(0x27); break;
      case 'CMA': emit(0x2F); break;
      case 'CMC': emit(0x3F); break;
      case 'STC': emit(0x37); break;
      case 'RLC': emit(0x07); break;
      case 'RRC': emit(0x0F); break;
      case 'RAL': emit(0x17); break;
      case 'RAR': emit(0x1F); break;
      case 'JMP': emitJmp(0xC3); break;
      case 'JNZ': emitJmp(0xC2); break;
      case 'JZ':  emitJmp(0xCA); break;
      case 'JNC': emitJmp(0xD2); break;
      case 'JC':  emitJmp(0xDA); break;
      case 'JPO': emitJmp(0xE2); break;
      case 'JPE': emitJmp(0xEA); break;
      case 'JP':  emitJmp(0xF2); break;
      case 'JM':  emitJmp(0xFA); break;
      case 'CALL':emitJmp(0xCD); break;
      case 'CNZ': emitJmp(0xC4); break;
      case 'CZ':  emitJmp(0xCC); break;
      case 'CNC': emitJmp(0xD4); break;
      case 'CC':  emitJmp(0xDC); break;
      case 'CPO': emitJmp(0xE4); break;
      case 'CPE': emitJmp(0xEC); break;
      case 'CP':  emitJmp(0xF4); break;
      case 'CM':  emitJmp(0xFC); break;
      case 'RET': emit(0xC9); break;
      case 'RNZ': emit(0xC0); break;
      case 'RZ':  emit(0xC8); break;
      case 'RNC': emit(0xD0); break;
      case 'RC':  emit(0xD8); break;
      case 'RPO': emit(0xE0); break;
      case 'RPE': emit(0xE8); break;
      case 'RP':  emit(0xF0); break;
      case 'RM':  emit(0xF8); break;
      case 'RST': { const n=getImm8(); emit(0xC7|(n<<3)); break; }
      case 'NOP': emit(0x00); break;
      case 'HLT': emit(0x76); break;
      case 'EI':  emit(0xFB); break;
      case 'DI':  emit(0xF3); break;
      case 'RIM': emit(0x20); break;
      case 'SIM': emit(0x30); break;
      case 'IN':  { emit(0xDB); emit(getImm8()); break; }
      case 'OUT': { emit(0xD3); emit(getImm8()); break; }
      case 'ASSERT': {
        // Syntax: ASSERT subject, value
        //   subject: A B C D E H L  (8-bit reg)   → 0xDD, code, val8
        //            CY Z S P AC    (flag)         → 0xDD, code, 0|1
        //            BC DE HL SP PC (16-bit pair)  → 0xDD, code, val16(le)
        //            MEM            (mem byte)     → 0xDD, 0x30, addr16(le), val8
        const REG8  = {B:0x00,C:0x01,D:0x02,E:0x03,H:0x04,L:0x05,A:0x07};
        const FLAGS = {CY:0x10,Z:0x11,S:0x12,P:0x13,AC:0x14};
        const PAIRS = {BC:0x20,DE:0x21,HL:0x22,SP:0x23,PC:0x24};
        const subj  = next();
        const sn    = subj?.val ?? '';
        expect('comma');
        emit(0xDD);
        if      (REG8[sn]  !== undefined) { emit(REG8[sn]);  emit(getImm8()); }
        else if (FLAGS[sn] !== undefined) { emit(FLAGS[sn]); emit(getImm8() & 1); }
        else if (PAIRS[sn] !== undefined) { emit(PAIRS[sn]); emit16(getImm16()); }
        else if (sn === 'MEM') {
          const addr = getImm16();
          expect('comma');
          emit(0x30); emit16(addr); emit(getImm8());
        } else {
          errors.push(`Line ${lineNo+1}: unknown ASSERT subject '${sn}'`);
          emit(0x00); // placeholder to avoid misalignment
        }
        break;
      }
      default:
        errors.push(`Line ${lineNo+1}: unknown mnemonic '${mnem}'`);
    }
  }

  // Apply label patches
  for (const p of patches) {
    const addr = labels[p.label];
    if (addr === undefined) {
      errors.push(`Line ${p.lineNo+1}: undefined label '${p.label}'`);
    } else {
      ram[p.addr] = addr & 0xFF;
      if (p.size !== 1) {
        ram[p.addr+1] = (addr >> 8) & 0xFF;
      }
    }
  }

  if (errors.length) {
    lastError = errors[0];
    return { ok: false, errorMsg: errors[0], errors };
  }

  lastSymbols    = {...labels}
  lastProgStart  = entryIP
  lastProgEnd    = ptr
  lastPresetAddrs = presetAddrs
  regs.pc = entryIP;
  return { ok: true, entryPoint: entryIP, bytesEmitted: ptr - entryIP, errors: [] };
}

// ── Interrupt check (called after every instruction, and during HLT wait) ─
function checkInterrupts() {
  if (status & (QUIT | SEVERE_ERROR)) return

  // TRAP — non-maskable, highest priority, fires once per assertion
  if (trapPend) {
    trapPend = false
    status &= ~HALTED
    push16(regs.pc); iff = false; iffNext = false
    regs.pc = 0x0024; return
  }

  if (status & HALTED) {
    // While halted, only TRAP (above) or maskable interrupts (if IFF=true) can resume
    if (!iff) return
  } else {
    // EI delay — iff becomes true but don't service until next check
    if (iffNext) { iff = true; iffNext = false; return }
    if (!iff) return
  }

  // RST 7.5 — edge latch, maskable (mask bit 2)
  if (rst75ff && !(intMask & 0x04)) {
    rst75ff = false
    status &= ~HALTED
    push16(regs.pc); iff = false; iffNext = false
    regs.pc = 0x003C; return
  }
  // RST 6.5 — level, maskable (mask bit 1)
  if (intLines.rst65 && !(intMask & 0x02)) {
    status &= ~HALTED
    push16(regs.pc); iff = false; iffNext = false
    regs.pc = 0x0034; return
  }
  // RST 5.5 — level, maskable (mask bit 0)
  if (intLines.rst55 && !(intMask & 0x01)) {
    status &= ~HALTED
    push16(regs.pc); iff = false; iffNext = false
    regs.pc = 0x002C; return
  }
  // INTR — level, maskable, RST n vector on data bus
  if (intLines.intr) {
    const vec = intLines.intrVec
    if ((vec & 0xC7) === 0xC7) {   // valid RST n opcode
      status &= ~HALTED
      push16(regs.pc); iff = false; iffNext = false
      regs.pc = vec & 0x38
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────
export function simInit() {
  ram = new Uint8Array(MAIN_MEMORY);
  regs = { a:0, b:0, c:0, d:0, e:0, h:0, l:0, flags:0, pc:DEFAULT_IP, sp:0 };
  status = 0;
  breakpoints = new Set();
  dataBPs.clear(); dataWatchHit = -1;
  leds.fill(0);
  lastError = '';
  ioOut.fill(0); ioOutTouched.clear();
  consoleBuf = '';
  lastSymbols = {}; cycles = 0; hitcnt.fill(0)
  lastProgStart = DEFAULT_IP; lastProgEnd = DEFAULT_IP; lastPresetAddrs = new Set()
  iff = false; iffNext = false; intMask = 0
  rst75ff = false; trapPend = false
  sidValue = 0; sodValue = 0
  intLines = { rst65: false, rst55: false, intr: false, intrVec: 0xFF }
  keyQueue = []
  // ioIn is intentionally NOT reset here — user presets survive a build
}

export function simSetInputPort(port, val) { ioIn[port & 0xFF] = val & 0xFF; }
export function simClearInputPort(port)    { ioIn[port & 0xFF] = 0; }
export function simGetOutputPorts() {
  return [...ioOutTouched].sort((a,b)=>a-b).map(p => ({ port: p, val: ioOut[p] }))
}

export function simAssemble(source) {
  return assemble(source);
}

export function simStep() {
  dataWatchHit = -1;
  const r = stepOne()
  checkInterrupts()
  return r
}

export function simRun(maxSteps = 100000) {
  let steps = 0;
  dataWatchHit = -1;
  while (steps < maxSteps) {
    if (status & (QUIT | SEVERE_ERROR)) return steps;
    if (status & HALTED) { checkInterrupts(); return steps; }
    if (!stepOne()) return steps;
    steps++;
    checkInterrupts()
    if (breakpoints.has(regs.pc)) return steps;
    if (dataWatchHit >= 0) return steps;
  }
  return steps;
}

export function simGetRegisters() {
  const f = regs.flags;
  return {
    a: regs.a, b: regs.b, c: regs.c, d: regs.d,
    e: regs.e, h: regs.h, l: regs.l,
    flags: f,
    pc: regs.pc, sp: regs.sp,
    flagS:  (f>>7)&1, flagZ: (f>>6)&1,
    flagAC: (f>>4)&1, flagP: (f>>2)&1, flagCY: f&1,
    halted:   !!(status & (HALTED|QUIT)),
    hasError: !!(status & SEVERE_ERROR),
    status,
  };
}

export function simGetMemory(start, length) {
  return ram.slice(start, start + length);
}

export function simReadByte(addr)      { return ram[addr & 0xFFFF] ?? 0; }
export function simWriteByte(addr, v)  { ram[addr & 0xFFFF] = v & 0xFF; }

export function simSetBreakpoint(addr) {
  if (breakpoints.has(addr)) { breakpoints.delete(addr); return 2; }
  breakpoints.add(addr); return 1;
}
export function simClearAllBreakpoints() { breakpoints.clear(); }

export function simSetDataBreakpoint(addr)   { if (dataBPs.has(addr)) { dataBPs.delete(addr); return 2; } dataBPs.add(addr); return 1; }
export function simClearDataBreakpoint(addr) { dataBPs.delete(addr); }
export function simClearAllDataBreakpoints() { dataBPs.clear(); dataWatchHit = -1; }
export function simGetDataBreakpoints()      { return [...dataBPs]; }
export function simGetDataWatchHit()         { return dataWatchHit; }

export function simGetAllLeds()       { return [...leds]; }
export function simIsHalted()         { return !!(status & (HALTED|QUIT)); }
export function simIsHaltWaiting()    { return !!(status & HALTED) && !(status & (QUIT|SEVERE_ERROR)); }
export function simIsRunning()        { return !(status & (HALTED|QUIT|SEVERE_ERROR)); }
export function simGetError()         { return lastError; }
export function simGetSymbols()       { return {...lastSymbols} }
export function simGetCycles()        { return cycles }
export function simSetCycles(n)       { cycles = n }
export function simGetHitcntRange(start, len) { return hitcnt.slice(start, start + len) }
export function simGetConsoleOutput() { return consoleBuf }
export function simClearConsoleOutput() { consoleBuf = '' }
export function simSetConsolePort(n)  { consolePort = n & 0xFF }
export function simGetConsolePort()   { return consolePort }
export function simGetProgramRegion() { return { start: lastProgStart, end: lastProgEnd } }
export function simGetPresetAddrs()   { return new Set(lastPresetAddrs) }

export function simSetMemorySize(n) {
  MAIN_MEMORY = n
  ram = new Uint8Array(n)
}

export function simAssertInterrupt(type, vec) {
  switch (type) {
    case 'TRAP':  trapPend = true; break
    case 'RST75': rst75ff  = true; break
    case 'RST65': intLines.rst65 = true; break
    case 'RST55': intLines.rst55 = true; break
    case 'INTR':  intLines.intr  = true
                  if (vec !== undefined) intLines.intrVec = vec & 0xFF
                  break
  }
}
export function simDeassertInterrupt(type) {
  switch (type) {
    case 'RST65': intLines.rst65 = false; break
    case 'RST55': intLines.rst55 = false; break
    case 'INTR':  intLines.intr  = false; break
  }
}
export function simEnqueueKeys(str) {
  for (let i = 0; i < str.length; i++) keyQueue.push(str.charCodeAt(i) & 0xFF)
}
export function simClearKeyQueue() { keyQueue = [] }
export function simGetKeyQueue()   { return keyQueue.map(c => String.fromCharCode(c)) }

export function simGetIntState() {
  return { iff, intMask, rst75ff, trapPend,
           rst65: intLines.rst65, rst55: intLines.rst55,
           intr: intLines.intr,   intrVec: intLines.intrVec }
}

export function simSetSID(v)      { sidValue = v & 1 }
export function simGetSOD()       { return sodValue }

export function simSetRegisters(r) {
  const c8  = v => Math.max(0, Math.min(255,   v | 0))
  const c16 = v => Math.max(0, Math.min(65535, v | 0))
  if (r.a     !== undefined) regs.a     = c8(r.a)
  if (r.b     !== undefined) regs.b     = c8(r.b)
  if (r.c     !== undefined) regs.c     = c8(r.c)
  if (r.d     !== undefined) regs.d     = c8(r.d)
  if (r.e     !== undefined) regs.e     = c8(r.e)
  if (r.h     !== undefined) regs.h     = c8(r.h)
  if (r.l     !== undefined) regs.l     = c8(r.l)
  if (r.flags !== undefined) regs.flags = c8(r.flags)
  if (r.pc    !== undefined) regs.pc    = c16(r.pc)
  if (r.sp    !== undefined) regs.sp    = c16(r.sp)
}

export function simGetFullMemory() { return ram.slice(); }

export function simRestoreSnapshot(snap) {
  Object.assign(regs, snap.regs)
  ram.set(snap.ram)
  status = 0
  lastError = ''
}

export function simDisassemble(addr) {
  if (addr >= MAIN_MEMORY) return { text: '???', len: 1 };
  const op = ram[addr];

  // ASSERT (0xDD — simulator-only instruction, variable length)
  if (op === 0xDD) {
    const sub = ram[addr+1] ?? 0;
    const REG8_N = ['B','C','D','E','H','L','M','A'];
    const FLAG_N = ['CY','Z','S','P','AC'];
    const PAIR_N = ['BC','DE','HL','SP','PC'];
    let mnemText = 'ASSERT ???', len = 2;
    if (sub <= 0x07) {
      const val = ram[addr+2] ?? 0;
      mnemText = `ASSERT ${REG8_N[sub]}, ${h(val)}H`; len = 3;
    } else if (sub >= 0x10 && sub <= 0x14) {
      const val = ram[addr+2] ?? 0;
      mnemText = `ASSERT ${FLAG_N[sub-0x10]}, ${val & 1}`; len = 3;
    } else if (sub >= 0x20 && sub <= 0x24) {
      const val = (ram[addr+2]??0) | ((ram[addr+3]??0) << 8);
      mnemText = `ASSERT ${PAIR_N[sub-0x20]}, ${h(val,4)}H`; len = 4;
    } else if (sub === 0x30) {
      const a16 = (ram[addr+2]??0) | ((ram[addr+3]??0) << 8);
      const val  = ram[addr+4] ?? 0;
      mnemText = `ASSERT MEM, ${h(a16,4)}H, ${h(val)}H`; len = 5;
    }
    return {
      text: `${h(addr,4)}  DD ${h(sub)}         ${mnemText}`,
      len, addr, mnem: 'ASSERT', cycles: 0,
    };
  }

  const LENS = [
    1,3,1,1,1,1,2,1,1,1,1,1,1,1,2,1,1,3,1,1,1,1,2,1,1,1,1,1,1,1,2,1,
    1,3,3,1,1,1,2,1,1,1,3,1,1,1,2,1,1,3,3,1,1,1,2,1,1,1,3,1,1,1,2,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,3,3,3,1,2,1,1,1,3,1,3,3,2,1,1,1,3,2,3,1,2,1,1,1,3,2,3,1,2,1,
    1,1,3,1,3,1,2,1,1,1,3,1,3,1,2,1,1,1,3,1,3,1,2,1,1,1,3,1,3,1,2,1,
  ];
  const NAMES = [
    'NOP','LXI B,','STAX B','INX B','INR B','DCR B','MVI B,','RLC',
    '???','DAD B','LDAX B','DCX B','INR C','DCR C','MVI C,','RRC',
    '???','LXI D,','STAX D','INX D','INR D','DCR D','MVI D,','RAL',
    '???','DAD D','LDAX D','DCX D','INR E','DCR E','MVI E,','RAR',
    'RIM','LXI H,','SHLD ','INX H','INR H','DCR H','MVI H,','DAA',
    '???','DAD H','LHLD ','DCX H','INR L','DCR L','MVI L,','CMA',
    'SIM','LXI SP,','STA ','INX SP','INR M','DCR M','MVI M,','STC',
    '???','DAD SP','LDA ','DCX SP','INR A','DCR A','MVI A,','CMC',
  ];
  const len = LENS[op] ?? 1;
  const b1 = ram[addr+1] ?? 0;
  const b2 = ram[addr+2] ?? 0;
  let name = '';
  if (op < 0x40) name = NAMES[op] ?? `???`;
  else if (op === 0x76) name = 'HLT';
  else if (op >= 0x40 && op < 0x80) {
    const dst=['B','C','D','E','H','L','M','A'][(op>>3)&7];
    const src=['B','C','D','E','H','L','M','A'][op&7];
    name = `MOV ${dst},${src}`;
  } else if (op >= 0x80 && op < 0xC0) {
    const AOPS=['ADD','ADC','SUB','SBB','ANA','XRA','ORA','CMP'];
    const regs2=['B','C','D','E','H','L','M','A'];
    name = `${AOPS[(op>>3)&7]} ${regs2[op&7]}`;
  } else {
    const HI = {
      0xC0:'RNZ',0xC1:'POP B',0xC2:'JNZ ',0xC3:'JMP ',0xC4:'CNZ ',0xC5:'PUSH B',
      0xC6:'ADI ',0xC7:'RST 0',0xC8:'RZ',0xC9:'RET',0xCA:'JZ ',0xCC:'CZ ',
      0xCD:'CALL ',0xCE:'ACI ',0xCF:'RST 1',
      0xD0:'RNC',0xD1:'POP D',0xD2:'JNC ',0xD3:'OUT ',0xD4:'CNC ',0xD5:'PUSH D',
      0xD6:'SUI ',0xD7:'RST 2',0xD8:'RC',0xD9:'???',0xDA:'JC ',0xDB:'IN ',
      0xDC:'CC ',0xDE:'SBI ',0xDF:'RST 3',
      0xE0:'RPO',0xE1:'POP H',0xE2:'JPO ',0xE3:'XTHL',0xE4:'CPO ',0xE5:'PUSH H',
      0xE6:'ANI ',0xE7:'RST 4',0xE8:'RPE',0xE9:'PCHL',0xEA:'JPE ',0xEB:'XCHG',
      0xEC:'CPE ',0xEE:'XRI ',0xEF:'RST 5',
      0xF0:'RP',0xF1:'POP PSW',0xF2:'JP ',0xF3:'DI',0xF4:'CP ',0xF5:'PUSH PSW',
      0xF6:'ORI ',0xF7:'RST 6',0xF8:'RM',0xF9:'SPHL',0xFA:'JM ',0xFB:'EI',
      0xFC:'CM ',0xFE:'CPI ',0xFF:'RST 7',
    };
    name = HI[op] ?? `???`;
  }
  let operand = '';
  if (len===2) operand = h(b1)+'H';
  if (len===3) operand = h(b2)+h(b1)+'H';
  return {
    text: `${h(addr,4)}  ${h(op)}${len>1?' '+h(b1):'   '}${len>2?' '+h(b2):'   '}  ${name}${operand}`,
    len, addr, mnem: name.trim(), cycles: TSTATES[op],
  };
}
