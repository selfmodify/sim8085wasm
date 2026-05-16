/**
 * sim8085.test.js
 * Comprehensive tests for the 8085 JS simulator (sim8085Bridge.js).
 * Covers every major instruction group: data transfer, arithmetic, logical,
 * rotate/shift, branching, stack, I/O, control, and flag behaviour.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  simInit, simAssemble, simStep, simRun, simGetRegisters, simSetRegisters,
  simGetMemory, simReadByte, simWriteByte,
  simIsHalted, simIsRunning, simIsHaltWaiting,
  simSetBreakpoint, simClearAllBreakpoints,
  simGetOutputPorts, simSetInputPort,
  simGetConsoleOutput, simSetConsolePort,
  simGetCycles, simGetAllLeds, simGetIntState,
} from './sim8085Bridge.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Assemble + run until HLT (or maxSteps). Returns final registers. */
function run(code, maxSteps = 500) {
  simInit();
  const res = simAssemble(code);
  if (!res.ok) throw new Error(`Assembly failed: ${res.errorMsg}`);
  let steps = 0;
  while (simIsRunning() && steps < maxSteps) { simStep(); steps++; }
  return simGetRegisters();
}

/** Assemble + run, return { regs, ok, steps }. */
function runFull(code, maxSteps = 500) {
  simInit();
  const res = simAssemble(code);
  if (!res.ok) return { ok: false, error: res.errorMsg };
  let steps = 0;
  while (simIsRunning() && steps < maxSteps) { simStep(); steps++; }
  return { ok: true, regs: simGetRegisters(), steps };
}

/** Flag bit accessors */
const CY  = r => r.flags & 0x01;
const P   = r => (r.flags >> 2) & 1;
const AC  = r => (r.flags >> 4) & 1;
const Z   = r => (r.flags >> 6) & 1;
const S   = r => (r.flags >> 7) & 1;

beforeEach(() => { simInit(); });

// ── Assembly ─────────────────────────────────────────────────────────────────
describe('Assembler', () => {
  it('assembles a minimal program successfully', () => {
    simInit();
    const res = simAssemble('ORG 100H\nNOP\nHLT');
    expect(res.ok).toBe(true);
    expect(res.bytesEmitted).toBeGreaterThan(0);
    expect(res.entryPoint).toBe(0x100);
  });

  it('returns an error for unknown mnemonics', () => {
    simInit();
    const res = simAssemble('ORG 100H\nFAKE A, B\nHLT');
    expect(res.ok).toBe(false);
    expect(res.errorMsg).toBeTruthy();
  });

  it('resolves labels correctly', () => {
    const r = run('ORG 100H\nJMP SKIP\nMVI A, 0FFH\nSKIP: MVI A, 42H\nHLT');
    expect(r.a).toBe(0x42);
  });
});

// ── NOP / HLT ────────────────────────────────────────────────────────────────
describe('NOP / HLT', () => {
  it('NOP does not change registers', () => {
    const r = run('ORG 100H\nNOP\nHLT');
    expect(r.a).toBe(0);
    expect(r.pc).toBe(0x102); // past HLT (NOP@100+1B, HLT@101+1B → PC=102)
  });

  it('HLT stops execution', () => {
    simInit();
    simAssemble('ORG 100H\nHLT');
    simStep();
    expect(simIsRunning()).toBe(false);
  });

  it('HLT enters halt-waiting state (resumes on interrupt)', () => {
    simInit();
    simAssemble('ORG 100H\nEI\nHLT');
    simStep(); simStep(); // EI then HLT
    expect(simIsHaltWaiting()).toBe(true);
  });
});

// ── MVI ──────────────────────────────────────────────────────────────────────
describe('MVI — move immediate', () => {
  it('MVI A', () => expect(run('ORG 100H\nMVI A, 42H\nHLT').a).toBe(0x42));
  it('MVI B', () => expect(run('ORG 100H\nMVI B, 11H\nHLT').b).toBe(0x11));
  it('MVI C', () => expect(run('ORG 100H\nMVI C, 22H\nHLT').c).toBe(0x22));
  it('MVI D', () => expect(run('ORG 100H\nMVI D, 33H\nHLT').d).toBe(0x33));
  it('MVI E', () => expect(run('ORG 100H\nMVI E, 44H\nHLT').e).toBe(0x44));
  it('MVI H', () => expect(run('ORG 100H\nMVI H, 55H\nHLT').h).toBe(0x55));
  it('MVI L', () => expect(run('ORG 100H\nMVI L, 66H\nHLT').l).toBe(0x66));
  it('MVI M writes to [HL]', () => {
    simInit();
    simAssemble('ORG 100H\nLXI H, 0200H\nMVI M, 0ABH\nHLT');
    while (simIsRunning()) simStep();
    expect(simReadByte(0x200)).toBe(0xAB);
  });
});

// ── LXI ──────────────────────────────────────────────────────────────────────
describe('LXI — load register pair immediate', () => {
  it('LXI B', () => {
    const r = run('ORG 100H\nLXI B, 1234H\nHLT');
    expect(r.b).toBe(0x12); expect(r.c).toBe(0x34);
  });
  it('LXI D', () => {
    const r = run('ORG 100H\nLXI D, 5678H\nHLT');
    expect(r.d).toBe(0x56); expect(r.e).toBe(0x78);
  });
  it('LXI H', () => {
    const r = run('ORG 100H\nLXI H, 9ABCH\nHLT');
    expect(r.h).toBe(0x9A); expect(r.l).toBe(0xBC);
  });
  it('LXI SP', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nHLT');
    expect(r.sp).toBe(0x2000);
  });
});

// ── MOV ──────────────────────────────────────────────────────────────────────
describe('MOV — register to register', () => {
  it('MOV A, B copies B to A', () => {
    const r = run('ORG 100H\nMVI B, 0AAH\nMOV A, B\nHLT');
    expect(r.a).toBe(0xAA); expect(r.b).toBe(0xAA);
  });
  it('MOV H, L copies L to H', () => {
    const r = run('ORG 100H\nMVI L, 55H\nMOV H, L\nHLT');
    expect(r.h).toBe(0x55);
  });
  it('MOV M, A writes A to [HL]', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 0BBH\nLXI H, 0300H\nMOV M, A\nHLT');
    while (simIsRunning()) simStep();
    expect(simReadByte(0x300)).toBe(0xBB);
  });
  it('MOV A, M reads [HL] into A', () => {
    simInit();
    simAssemble('ORG 100H\nLXI H, 0300H\nMOV A, M\nHLT');
    simWriteByte(0x300, 0xCC); // write after assembly (assembly resets RAM)
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0xCC);
  });
});

// ── LDA / STA ────────────────────────────────────────────────────────────────
describe('LDA / STA — direct memory access', () => {
  it('STA stores A to address', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 77H\nSTA 0400H\nHLT');
    while (simIsRunning()) simStep();
    expect(simReadByte(0x400)).toBe(0x77);
  });
  it('LDA loads from address into A', () => {
    simInit();
    simAssemble('ORG 100H\nLDA 0400H\nHLT');
    simWriteByte(0x400, 0x88); // write after assembly
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x88);
  });
});

// ── LDAX / STAX ──────────────────────────────────────────────────────────────
describe('LDAX / STAX', () => {
  it('STAX B stores A to [BC]', () => {
    simInit();
    simAssemble('ORG 100H\nLXI B, 0500H\nMVI A, 99H\nSTAX B\nHLT');
    while (simIsRunning()) simStep();
    expect(simReadByte(0x500)).toBe(0x99);
  });
  it('LDAX D loads A from [DE]', () => {
    simInit();
    simAssemble('ORG 100H\nLXI D, 0500H\nLDAX D\nHLT');
    simWriteByte(0x500, 0xDD); // write after assembly
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0xDD);
  });
});

// ── LHLD / SHLD ──────────────────────────────────────────────────────────────
describe('LHLD / SHLD', () => {
  it('SHLD stores HL to memory (little-endian)', () => {
    simInit();
    simAssemble('ORG 100H\nLXI H, 1234H\nSHLD 0600H\nHLT');
    while (simIsRunning()) simStep();
    expect(simReadByte(0x600)).toBe(0x34); // L at low address
    expect(simReadByte(0x601)).toBe(0x12); // H at high address
  });
  it('LHLD loads HL from memory', () => {
    simInit();
    simAssemble('ORG 100H\nLHLD 0600H\nHLT');
    simWriteByte(0x600, 0x78); simWriteByte(0x601, 0x56); // write after assembly
    while (simIsRunning()) simStep();
    const r = simGetRegisters();
    expect(r.l).toBe(0x78); expect(r.h).toBe(0x56);
  });
});

// ── XCHG ─────────────────────────────────────────────────────────────────────
describe('XCHG', () => {
  it('swaps HL and DE', () => {
    const r = run('ORG 100H\nLXI H, 1111H\nLXI D, 2222H\nXCHG\nHLT');
    expect(r.h).toBe(0x22); expect(r.l).toBe(0x22);
    expect(r.d).toBe(0x11); expect(r.e).toBe(0x11);
  });
});

// ── SPHL / PCHL ──────────────────────────────────────────────────────────────
describe('SPHL / PCHL', () => {
  it('SPHL copies HL to SP', () => {
    const r = run('ORG 100H\nLXI H, 3000H\nSPHL\nHLT');
    expect(r.sp).toBe(0x3000);
  });
  it('PCHL jumps to address in HL', () => {
    // PCHL at 100H jumps to 200H where HLT is
    const r = run('ORG 100H\nLXI H, 0200H\nPCHL\nORG 0200H\nMVI A, 42H\nHLT');
    expect(r.a).toBe(0x42);
  });
});

// ── ADD / ADI ────────────────────────────────────────────────────────────────
describe('ADD / ADI — addition', () => {
  it('ADI adds immediate to A', () => {
    const r = run('ORG 100H\nMVI A, 10H\nADI 20H\nHLT');
    expect(r.a).toBe(0x30);
  });
  it('ADD B adds register B to A', () => {
    const r = run('ORG 100H\nMVI A, 0AH\nMVI B, 05H\nADD B\nHLT');
    expect(r.a).toBe(0x0F);
  });
  it('ADD sets carry on overflow (FF + 01)', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nADI 01H\nHLT');
    expect(r.a).toBe(0x00);
    expect(CY(r)).toBe(1);
    expect(Z(r)).toBe(1);
  });
  it('ADD sets sign flag on negative result', () => {
    const r = run('ORG 100H\nMVI A, 40H\nADI 40H\nHLT');
    expect(S(r)).toBe(1); // 0x80 has bit 7 set
  });
  it('ADD sets auxiliary carry on nibble overflow', () => {
    const r = run('ORG 100H\nMVI A, 0FH\nADI 01H\nHLT');
    expect(AC(r)).toBe(1);
  });
});

// ── ADC / ACI ────────────────────────────────────────────────────────────────
describe('ADC / ACI — add with carry', () => {
  it('ADC adds carry bit', () => {
    // Set carry by adding FF+01, then ADC B adds B + carry(1)
    const r = run('ORG 100H\nMVI A, 0FFH\nADI 01H\nMVI A, 00H\nMVI B, 01H\nADC B\nHLT');
    expect(r.a).toBe(0x02); // 0 + 1 + carry(1)
  });
  it('ACI adds immediate with carry', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nADI 01H\nMVI A, 00H\nACI 01H\nHLT');
    expect(r.a).toBe(0x02);
  });
});

// ── SUB / SUI ────────────────────────────────────────────────────────────────
describe('SUB / SUI — subtraction', () => {
  it('SUI subtracts immediate', () => {
    const r = run('ORG 100H\nMVI A, 30H\nSUI 10H\nHLT');
    expect(r.a).toBe(0x20);
  });
  it('SUB B', () => {
    const r = run('ORG 100H\nMVI A, 0AH\nMVI B, 03H\nSUB B\nHLT');
    expect(r.a).toBe(0x07);
  });
  it('SUB sets zero flag on A - A', () => {
    const r = run('ORG 100H\nMVI A, 55H\nSUB A\nHLT');
    expect(r.a).toBe(0);
    expect(Z(r)).toBe(1);
  });
  it('SUB sets carry (borrow) when result underflows', () => {
    const r = run('ORG 100H\nMVI A, 00H\nSUI 01H\nHLT');
    expect(r.a).toBe(0xFF);
    expect(CY(r)).toBe(1);
  });
});

// ── SBB / SBI ────────────────────────────────────────────────────────────────
describe('SBB / SBI — subtract with borrow', () => {
  it('SBB subtracts register plus carry', () => {
    // First create carry, then subtract with borrow
    const r = run('ORG 100H\nMVI A, 00H\nSUI 01H\nMVI A, 05H\nMVI B, 02H\nSBB B\nHLT');
    expect(r.a).toBe(0x02); // 5 - 2 - carry(1) = 2
  });
});

// ── INR / DCR ────────────────────────────────────────────────────────────────
describe('INR / DCR — increment/decrement register', () => {
  it('INR A increments accumulator', () => {
    const r = run('ORG 100H\nMVI A, 0FEH\nINR A\nHLT');
    expect(r.a).toBe(0xFF);
    expect(Z(r)).toBe(0);
  });
  it('INR A wraps 0xFF → 0x00 and sets zero', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nINR A\nHLT');
    expect(r.a).toBe(0x00);
    expect(Z(r)).toBe(1);
  });
  it('INR does NOT affect carry flag', () => {
    // Set carry first, then INR — carry should be unchanged
    const r = run('ORG 100H\nMVI A, 0FFH\nADI 01H\nMVI A, 0FFH\nINR A\nHLT');
    expect(CY(r)).toBe(1); // carry preserved from ADD
  });
  it('DCR B decrements B', () => {
    const r = run('ORG 100H\nMVI B, 05H\nDCR B\nHLT');
    expect(r.b).toBe(0x04);
  });
  it('DCR sets zero when result is 0', () => {
    const r = run('ORG 100H\nMVI B, 01H\nDCR B\nHLT');
    expect(r.b).toBe(0x00);
    expect(Z(r)).toBe(1);
  });
});

// ── INX / DCX ────────────────────────────────────────────────────────────────
describe('INX / DCX — increment/decrement register pair', () => {
  it('INX B increments BC as 16-bit', () => {
    const r = run('ORG 100H\nLXI B, 00FFH\nINX B\nHLT');
    expect(r.b).toBe(0x01); expect(r.c).toBe(0x00);
  });
  it('INX H increments HL', () => {
    const r = run('ORG 100H\nLXI H, 1234H\nINX H\nHLT');
    expect(r.h).toBe(0x12); expect(r.l).toBe(0x35);
  });
  it('DCX D decrements DE', () => {
    const r = run('ORG 100H\nLXI D, 0100H\nDCX D\nHLT');
    expect(r.d).toBe(0x00); expect(r.e).toBe(0xFF);
  });
  it('INX SP increments stack pointer', () => {
    const r = run('ORG 100H\nLXI SP, 1FFFH\nINX SP\nHLT');
    expect(r.sp).toBe(0x2000);
  });
});

// ── DAD ──────────────────────────────────────────────────────────────────────
describe('DAD — double add (16-bit)', () => {
  it('DAD B adds BC to HL', () => {
    const r = run('ORG 100H\nLXI H, 1000H\nLXI B, 0234H\nDAD B\nHLT');
    expect(r.h).toBe(0x12); expect(r.l).toBe(0x34);
  });
  it('DAD H doubles HL', () => {
    const r = run('ORG 100H\nLXI H, 1000H\nDAD H\nHLT');
    expect(r.h).toBe(0x20); expect(r.l).toBe(0x00);
  });
  it('DAD sets carry on 16-bit overflow', () => {
    const r = run('ORG 100H\nLXI H, 0FFFFH\nLXI B, 0001H\nDAD B\nHLT');
    expect(r.h).toBe(0x00); expect(r.l).toBe(0x00);
    expect(CY(r)).toBe(1);
  });
});

// ── ANA / ANI ────────────────────────────────────────────────────────────────
describe('ANA / ANI — bitwise AND', () => {
  it('ANI masks A with immediate', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nANI 0FH\nHLT');
    expect(r.a).toBe(0x0F);
  });
  it('ANA B', () => {
    const r = run('ORG 100H\nMVI A, 0F0H\nMVI B, 0FFH\nANA B\nHLT');
    expect(r.a).toBe(0xF0);
  });
  it('ANI clears carry flag', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nADI 01H\nMVI A, 0FFH\nANI 0FFH\nHLT');
    expect(CY(r)).toBe(0);
  });
  it('AND sets zero when result is 0', () => {
    const r = run('ORG 100H\nMVI A, 0F0H\nANI 0FH\nHLT');
    expect(r.a).toBe(0x00);
    expect(Z(r)).toBe(1);
  });
});

// ── ORA / ORI ────────────────────────────────────────────────────────────────
describe('ORA / ORI — bitwise OR', () => {
  it('ORI sets bits in A', () => {
    const r = run('ORG 100H\nMVI A, 0F0H\nORI 0FH\nHLT');
    expect(r.a).toBe(0xFF);
  });
  it('ORA B ORs register', () => {
    const r = run('ORG 100H\nMVI A, 0AAH\nMVI B, 55H\nORA B\nHLT');
    expect(r.a).toBe(0xFF);
  });
  it('ORA A clears carry flag', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nADI 01H\nMVI A, 0H\nORA A\nHLT');
    expect(CY(r)).toBe(0);
  });
});

// ── XRA / XRI ────────────────────────────────────────────────────────────────
describe('XRA / XRI — bitwise XOR', () => {
  it('XRA A clears A to zero', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nXRA A\nHLT');
    expect(r.a).toBe(0x00);
    expect(Z(r)).toBe(1);
  });
  it('XRI flips bits', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nXRI 0FH\nHLT');
    expect(r.a).toBe(0xF0);
  });
});

// ── CMP / CPI ────────────────────────────────────────────────────────────────
describe('CMP / CPI — compare', () => {
  it('CPI sets Z when equal', () => {
    const r = run('ORG 100H\nMVI A, 42H\nCPI 42H\nHLT');
    expect(Z(r)).toBe(1);
    expect(r.a).toBe(0x42); // A unchanged
  });
  it('CPI sets CY when A < immediate', () => {
    const r = run('ORG 100H\nMVI A, 01H\nCPI 02H\nHLT');
    expect(CY(r)).toBe(1);
  });
  it('CMP B sets Z when A == B', () => {
    const r = run('ORG 100H\nMVI A, 33H\nMVI B, 33H\nCMP B\nHLT');
    expect(Z(r)).toBe(1);
  });
});

// ── CMA / STC / CMC ──────────────────────────────────────────────────────────
describe('CMA / STC / CMC', () => {
  it('CMA complements accumulator', () => {
    const r = run('ORG 100H\nMVI A, 0F0H\nCMA\nHLT');
    expect(r.a).toBe(0x0F);
  });
  it('STC sets carry flag', () => {
    const r = run('ORG 100H\nSTC\nHLT');
    expect(CY(r)).toBe(1);
  });
  it('CMC complements carry (0→1)', () => {
    const r = run('ORG 100H\nCMC\nHLT');
    expect(CY(r)).toBe(1);
  });
  it('CMC complements carry (1→0)', () => {
    const r = run('ORG 100H\nSTC\nCMC\nHLT');
    expect(CY(r)).toBe(0);
  });
});

// ── RLC / RRC / RAL / RAR ────────────────────────────────────────────────────
describe('Rotate instructions', () => {
  it('RLC rotates A left, MSB goes to CY and bit 0', () => {
    const r = run('ORG 100H\nMVI A, 80H\nRLC\nHLT');
    expect(r.a).toBe(0x01);
    expect(CY(r)).toBe(1);
  });
  it('RRC rotates A right, LSB goes to CY and bit 7', () => {
    const r = run('ORG 100H\nMVI A, 01H\nRRC\nHLT');
    expect(r.a).toBe(0x80);
    expect(CY(r)).toBe(1);
  });
  it('RAL rotates through carry left', () => {
    const r = run('ORG 100H\nSTC\nMVI A, 40H\nRAL\nHLT');
    expect(r.a).toBe(0x81); // 0x40 << 1 | carry_in(1)
    expect(CY(r)).toBe(0);
  });
  it('RAR rotates through carry right', () => {
    const r = run('ORG 100H\nSTC\nMVI A, 02H\nRAR\nHLT');
    expect(r.a).toBe(0x81); // carry_in→MSB, LSB→carry_out
    expect(CY(r)).toBe(0);
  });
});

// ── Branching ────────────────────────────────────────────────────────────────
describe('JMP — unconditional jump', () => {
  it('jumps to target label', () => {
    const r = run('ORG 100H\nJMP DONE\nMVI A, 0FFH\nDONE: MVI A, 42H\nHLT');
    expect(r.a).toBe(0x42);
  });
});

describe('Conditional jumps', () => {
  it('JZ jumps when Z=1', () => {
    const r = run('ORG 100H\nMVI A, 00H\nCPI 00H\nJZ HIT\nMVI B, 0FFH\nHIT: MVI B, 42H\nHLT');
    expect(r.b).toBe(0x42);
  });
  it('JNZ jumps when Z=0', () => {
    const r = run('ORG 100H\nMVI A, 01H\nCPI 00H\nJNZ HIT\nMVI B, 00H\nHIT: MVI B, 42H\nHLT');
    expect(r.b).toBe(0x42);
  });
  it('JC jumps when CY=1', () => {
    const r = run('ORG 100H\nSTC\nJC HIT\nMVI B, 00H\nHIT: MVI B, 42H\nHLT');
    expect(r.b).toBe(0x42);
  });
  it('JNC jumps when CY=0', () => {
    const r = run('ORG 100H\nJNC HIT\nMVI B, 00H\nHIT: MVI B, 42H\nHLT');
    expect(r.b).toBe(0x42);
  });
  it('JM jumps when S=1', () => {
    const r = run('ORG 100H\nMVI A, 0FFH\nADI 01H\nMVI A, 80H\nADI 00H\nJM HIT\nMVI B, 00H\nHIT: MVI B, 42H\nHLT');
    expect(r.b).toBe(0x42);
  });
  it('JP jumps when S=0', () => {
    const r = run('ORG 100H\nMVI A, 01H\nADI 00H\nJP HIT\nMVI B, 00H\nHIT: MVI B, 42H\nHLT');
    expect(r.b).toBe(0x42);
  });
});

// ── CALL / RET ───────────────────────────────────────────────────────────────
describe('CALL / RET', () => {
  it('CALL pushes return address and jumps', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nCALL SUB\nHLT\nSUB: MVI A, 42H\nRET');
    expect(r.a).toBe(0x42);
  });
  it('RET restores PC from stack', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nMVI B, 01H\nCALL SUB\nMVI B, 02H\nHLT\nSUB: RET');
    expect(r.b).toBe(0x02); // execution continued after CALL
  });
  it('nested CALL/RET works', () => {
    // Use non-hex-ambiguous label names (A1/A2 look like hex literals to the assembler)
    const r = run([
      'ORG 100H',
      'LXI SP, 3000H',
      'CALL OUTER',
      'HLT',
      'OUTER: CALL INNER',
      'RET',
      'INNER: MVI A, 99H',
      'RET',
    ].join('\n'));
    expect(r.a).toBe(0x99);
  });
  it('CZ calls subroutine when Z=1', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nMVI A, 0H\nCPI 0H\nCZ SUB\nHLT\nSUB: MVI B, 42H\nRET');
    expect(r.b).toBe(0x42);
  });
  it('RZ returns when Z=1', () => {
    const r = run(`ORG 100H
      LXI SP, 2000H
      CALL SUB
      HLT
      SUB: MVI A, 00H
           CPI 00H
           RZ
           MVI A, 0FFH
           RET`);
    expect(r.a).toBe(0x00); // RZ fired, 0xFF never loaded
  });
});

// ── PUSH / POP ───────────────────────────────────────────────────────────────
describe('PUSH / POP', () => {
  it('PUSH B / POP B round-trips BC', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nLXI B, 1234H\nPUSH B\nLXI B, 0000H\nPOP B\nHLT');
    expect(r.b).toBe(0x12); expect(r.c).toBe(0x34);
  });
  it('PUSH D / POP D round-trips DE', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nLXI D, 5678H\nPUSH D\nLXI D, 0000H\nPOP D\nHLT');
    expect(r.d).toBe(0x56); expect(r.e).toBe(0x78);
  });
  it('PUSH H / POP H round-trips HL', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nLXI H, 9ABCH\nPUSH H\nLXI H, 0000H\nPOP H\nHLT');
    expect(r.h).toBe(0x9A); expect(r.l).toBe(0xBC);
  });
  it('PUSH PSW / POP PSW round-trips A and flags', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nMVI A, 42H\nSTC\nPUSH PSW\nMVI A, 00H\nXRA A\nPOP PSW\nHLT');
    expect(r.a).toBe(0x42);
    expect(CY(r)).toBe(1);
  });
  it('PUSH decrements SP by 2', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nLXI B, 1234H\nPUSH B\nHLT');
    expect(r.sp).toBe(0x1FFE);
  });
  it('POP increments SP by 2', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nLXI B, 1234H\nPUSH B\nPOP D\nHLT');
    expect(r.sp).toBe(0x2000);
  });
});

// ── XTHL ─────────────────────────────────────────────────────────────────────
describe('XTHL', () => {
  it('exchanges HL with top of stack', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nLXI B, 1234H\nPUSH B\nLXI H, 5678H\nXTHL\nHLT');
    expect(r.h).toBe(0x12); expect(r.l).toBe(0x34);
    expect(simReadByte(0x1FFE)).toBe(0x78); // previous L
    expect(simReadByte(0x1FFF)).toBe(0x56); // previous H
  });
});

// ── I/O Instructions ─────────────────────────────────────────────────────────
describe('IN / OUT', () => {
  it('OUT writes A to specified port', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 55H\nOUT 01H\nHLT');
    while (simIsRunning()) simStep();
    const ports = simGetOutputPorts();
    const port1 = ports.find(p => p.port === 0x01);
    expect(port1?.val).toBe(0x55);
  });

  it('IN reads preset value from port into A', () => {
    simInit();
    simSetInputPort(0x02, 0xAA);
    simAssemble('ORG 100H\nIN 02H\nHLT');
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0xAA);
  });

  it('OUT to console port writes ASCII to console buffer', () => {
    simInit();
    simSetConsolePort(0x01);
    simAssemble('ORG 100H\nMVI A, 41H\nOUT 01H\nHLT'); // 41H = 'A'
    while (simIsRunning()) simStep();
    expect(simGetConsoleOutput()).toContain('A');
  });
});

// ── EI / DI ──────────────────────────────────────────────────────────────────
describe('EI / DI — interrupt enable/disable', () => {
  it('EI enables interrupts', () => {
    run('ORG 100H\nEI\nHLT');
    // After EI+HLT, the interrupt flip-flop should be enabled
    // (HLT with EI puts it in halt-wait mode)
    expect(simGetIntState().iff).toBe(true);
  });
  it('DI disables interrupts', () => {
    run('ORG 100H\nEI\nNOP\nDI\nHLT');
    expect(simGetIntState().iff).toBe(false);
  });
});

// ── Cycle counting ───────────────────────────────────────────────────────────
describe('Cycle counting', () => {
  it('NOP costs 4 T-states', () => {
    simInit();
    simAssemble('ORG 100H\nNOP\nHLT');
    const before = simGetCycles();
    simStep(); // NOP
    expect(simGetCycles() - before).toBe(4);
  });
  it('LXI costs 10 T-states', () => {
    simInit();
    simAssemble('ORG 100H\nLXI B, 1234H\nHLT');
    const before = simGetCycles();
    simStep();
    expect(simGetCycles() - before).toBe(10);
  });
  it('MVI costs 7 T-states', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 42H\nHLT');
    const before = simGetCycles();
    simStep();
    expect(simGetCycles() - before).toBe(7);
  });
});

// ── Breakpoints ──────────────────────────────────────────────────────────────
describe('Breakpoints', () => {
  it('stops at a breakpoint address', () => {
    simInit();
    const res = simAssemble('ORG 100H\nNOP\nMVI A, 42H\nHLT');
    expect(res.ok).toBe(true);
    // 100H=NOP(1B), 101H=MVI A,42H(2B) → breakpoint at 101H
    simSetBreakpoint(0x101);
    simRun(100); // simRun checks breakpoints after each step
    // Stopped at 101H before executing MVI A,42H
    expect(simGetRegisters().pc).toBe(0x101);
    expect(simGetRegisters().a).toBe(0); // MVI A not yet executed
  });

  it('clears all breakpoints', () => {
    simInit();
    simAssemble('ORG 100H\nNOP\nMVI A, 42H\nHLT');
    simSetBreakpoint(0x101);
    simClearAllBreakpoints();
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x42); // ran past 101H
  });
});

// ── Memory direct access ─────────────────────────────────────────────────────
describe('simWriteByte / simReadByte / simGetMemory', () => {
  it('writes and reads single bytes', () => {
    simInit();
    simWriteByte(0x300, 0xDE);
    expect(simReadByte(0x300)).toBe(0xDE);
  });
  it('simGetMemory returns a Uint8Array slice', () => {
    simInit();
    simWriteByte(0x200, 0x11);
    simWriteByte(0x201, 0x22);
    const mem = simGetMemory(0x200, 2);
    expect(mem[0]).toBe(0x11);
    expect(mem[1]).toBe(0x22);
  });
});

// ── simSetRegisters ──────────────────────────────────────────────────────────
describe('simSetRegisters', () => {
  it('overwrites individual registers', () => {
    simInit();
    simSetRegisters({ a: 0x42, b: 0x11 });
    const r = simGetRegisters();
    expect(r.a).toBe(0x42);
    expect(r.b).toBe(0x11);
  });
  it('leaves unspecified registers unchanged', () => {
    simInit();
    simSetRegisters({ c: 0x55 });
    const r = simGetRegisters();
    expect(r.c).toBe(0x55);
    expect(r.a).toBe(0); // untouched
  });
});

// ── DAA ──────────────────────────────────────────────────────────────────────
describe('DAA — decimal adjust accumulator', () => {
  it('adjusts sum of two packed BCD digits', () => {
    // 0x28 + 0x35 = 0x5D → DAA → 0x63 (63 decimal = 28+35)
    const r = run('ORG 100H\nMVI A, 28H\nADI 35H\nDAA\nHLT');
    expect(r.a).toBe(0x63);
  });
  it('sets carry when BCD result exceeds 99', () => {
    // 0x99 + 0x01 = 0x9A → DAA → 0x00 with carry
    const r = run('ORG 100H\nMVI A, 99H\nADI 01H\nDAA\nHLT');
    expect(r.a).toBe(0x00);
    expect(CY(r)).toBe(1);
  });
});

// ── SBI ──────────────────────────────────────────────────────────────────────
describe('SBI — subtract immediate with borrow', () => {
  it('subtracts immediate plus carry from A', () => {
    // Create carry=1 via SUI underflow, then SBI 01H: 05 - 01 - 1 = 03
    const r = run('ORG 100H\nMVI A, 00H\nSUI 01H\nMVI A, 05H\nSBI 01H\nHLT');
    expect(r.a).toBe(0x03);
  });
});

// ── Memory operand forms ──────────────────────────────────────────────────────
describe('Memory operand instructions (M = [HL])', () => {
  it('ADD M adds [HL] to A', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 10H\nLXI H, 0300H\nADD M\nHLT');
    simWriteByte(0x300, 0x05);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x15);
  });
  it('ADC M adds [HL] plus carry to A', () => {
    simInit();
    simAssemble('ORG 100H\nSTC\nMVI A, 10H\nLXI H, 0300H\nADC M\nHLT');
    simWriteByte(0x300, 0x05);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x16); // 0x10 + 0x05 + carry(1)
  });
  it('SUB M subtracts [HL] from A', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 20H\nLXI H, 0300H\nSUB M\nHLT');
    simWriteByte(0x300, 0x08);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x18);
  });
  it('SBB M subtracts [HL] plus carry from A', () => {
    simInit();
    simAssemble('ORG 100H\nSTC\nMVI A, 10H\nLXI H, 0300H\nSBB M\nHLT');
    simWriteByte(0x300, 0x05);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x0A); // 0x10 - 0x05 - 1
  });
  it('ANA M ANDs [HL] with A', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 0FFH\nLXI H, 0300H\nANA M\nHLT');
    simWriteByte(0x300, 0x0F);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x0F);
  });
  it('ORA M ORs [HL] with A', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 0F0H\nLXI H, 0300H\nORA M\nHLT');
    simWriteByte(0x300, 0x0F);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0xFF);
  });
  it('XRA M XORs [HL] with A', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 0FFH\nLXI H, 0300H\nXRA M\nHLT');
    simWriteByte(0x300, 0x55);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0xAA);
  });
  it('CMP M sets Z when A == [HL]', () => {
    simInit();
    simAssemble('ORG 100H\nMVI A, 42H\nLXI H, 0300H\nCMP M\nHLT');
    simWriteByte(0x300, 0x42);
    while (simIsRunning()) simStep();
    expect(Z(simGetRegisters())).toBe(1);
    expect(simGetRegisters().a).toBe(0x42); // A unchanged
  });
  it('INR M increments byte at [HL]', () => {
    simInit();
    simAssemble('ORG 100H\nLXI H, 0300H\nINR M\nHLT');
    simWriteByte(0x300, 0x09);
    while (simIsRunning()) simStep();
    expect(simReadByte(0x300)).toBe(0x0A);
  });
  it('DCR M decrements byte at [HL]', () => {
    simInit();
    simAssemble('ORG 100H\nLXI H, 0300H\nDCR M\nHLT');
    simWriteByte(0x300, 0x05);
    while (simIsRunning()) simStep();
    expect(simReadByte(0x300)).toBe(0x04);
  });
});

// ── STAX D ───────────────────────────────────────────────────────────────────
describe('STAX D', () => {
  it('stores A to [DE]', () => {
    simInit();
    simAssemble('ORG 100H\nLXI D, 0500H\nMVI A, 0EEH\nSTAX D\nHLT');
    while (simIsRunning()) simStep();
    expect(simReadByte(0x500)).toBe(0xEE);
  });
});

// ── DAD D / DAD SP ───────────────────────────────────────────────────────────
describe('DAD D / DAD SP', () => {
  it('DAD D adds DE to HL', () => {
    const r = run('ORG 100H\nLXI H, 1000H\nLXI D, 0234H\nDAD D\nHLT');
    expect(r.h).toBe(0x12); expect(r.l).toBe(0x34);
  });
  it('DAD SP adds SP to HL', () => {
    const r = run('ORG 100H\nLXI SP, 1000H\nLXI H, 0234H\nDAD SP\nHLT');
    expect(r.h).toBe(0x12); expect(r.l).toBe(0x34);
  });
});

// ── DCX variants ─────────────────────────────────────────────────────────────
describe('DCX B / DCX H / DCX SP', () => {
  it('DCX B decrements BC', () => {
    const r = run('ORG 100H\nLXI B, 0200H\nDCX B\nHLT');
    expect(r.b).toBe(0x01); expect(r.c).toBe(0xFF);
  });
  it('DCX H decrements HL', () => {
    const r = run('ORG 100H\nLXI H, 1000H\nDCX H\nHLT');
    expect(r.h).toBe(0x0F); expect(r.l).toBe(0xFF);
  });
  it('DCX SP decrements stack pointer', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nDCX SP\nHLT');
    expect(r.sp).toBe(0x1FFF);
  });
});

// ── INX D / INX SP ───────────────────────────────────────────────────────────
describe('INX D / INX SP', () => {
  it('INX D increments DE', () => {
    const r = run('ORG 100H\nLXI D, 00FFH\nINX D\nHLT');
    expect(r.d).toBe(0x01); expect(r.e).toBe(0x00);
  });
  it('INX SP increments stack pointer', () => {
    const r = run('ORG 100H\nLXI SP, 1FFEH\nINX SP\nHLT');
    expect(r.sp).toBe(0x1FFF);
  });
});

// ── Parity conditional jumps ──────────────────────────────────────────────────
describe('JPE / JPO — parity conditional jumps', () => {
  it('JPE jumps when parity is even (P=1)', () => {
    // 0xFF has 8 bits set — even parity
    const r = run('ORG 100H\nMVI A, 0FFH\nADI 00H\nJPE HIT\nMVI B, 00H\nHIT: MVI B, 42H\nHLT');
    expect(r.b).toBe(0x42);
  });
  it('JPO jumps when parity is odd (P=0)', () => {
    // 0x01 has 1 bit set — odd parity
    const r = run('ORG 100H\nMVI A, 01H\nADI 00H\nJPO HIT\nMVI B, 00H\nHIT: MVI B, 42H\nHLT');
    expect(r.b).toBe(0x42);
  });
});

// ── Remaining conditional calls ───────────────────────────────────────────────
describe('CC / CNC / CM / CP / CNZ conditional calls', () => {
  it('CC calls when CY=1', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nSTC\nCC SUB\nHLT\nSUB: MVI B, 42H\nRET');
    expect(r.b).toBe(0x42);
  });
  it('CC does not call when CY=0', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nCC SUB\nHLT\nSUB: MVI B, 0FFH\nRET');
    expect(r.b).toBe(0x00);
  });
  it('CNC calls when CY=0', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nCNC SUB\nHLT\nSUB: MVI B, 42H\nRET');
    expect(r.b).toBe(0x42);
  });
  it('CM calls when S=1', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nMVI A, 80H\nADI 00H\nCM SUB\nHLT\nSUB: MVI B, 42H\nRET');
    expect(r.b).toBe(0x42);
  });
  it('CP calls when S=0', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nMVI A, 01H\nADI 00H\nCP SUB\nHLT\nSUB: MVI B, 42H\nRET');
    expect(r.b).toBe(0x42);
  });
  it('CNZ calls when Z=0', () => {
    const r = run('ORG 100H\nLXI SP, 2000H\nMVI A, 01H\nCPI 00H\nCNZ SUB\nHLT\nSUB: MVI B, 42H\nRET');
    expect(r.b).toBe(0x42);
  });
});

// ── Remaining conditional returns ────────────────────────────────────────────
describe('RC / RNC / RNZ / RM / RP conditional returns', () => {
  it('RC returns when CY=1', () => {
    const r = run(`ORG 100H
      LXI SP, 2000H
      CALL SUB
      HLT
      SUB: STC
           RC
           MVI A, 0FFH
           RET`);
    expect(r.a).toBe(0x00); // RC fired; 0xFF never reached
  });
  it('RNC returns when CY=0', () => {
    const r = run(`ORG 100H
      LXI SP, 2000H
      CALL SUB
      HLT
      SUB: RNC
           MVI A, 0FFH
           RET`);
    expect(r.a).toBe(0x00); // RNC fired immediately (no carry after init)
  });
  it('RNZ returns when Z=0', () => {
    const r = run(`ORG 100H
      LXI SP, 2000H
      CALL SUB
      HLT
      SUB: MVI A, 01H
           CPI 00H
           RNZ
           MVI A, 0FFH
           RET`);
    expect(r.a).toBe(0x01); // RNZ fired; 0xFF never reached
  });
  it('RM returns when S=1', () => {
    const r = run(`ORG 100H
      LXI SP, 2000H
      CALL SUB
      HLT
      SUB: MVI A, 80H
           ADI 00H
           RM
           MVI A, 00H
           RET`);
    expect(r.a).toBe(0x80); // RM fired
  });
  it('RP returns when S=0', () => {
    const r = run(`ORG 100H
      LXI SP, 2000H
      CALL SUB
      HLT
      SUB: MVI A, 01H
           ADI 00H
           RP
           MVI A, 00H
           RET`);
    expect(r.a).toBe(0x01); // RP fired
  });
});

// ── RST ──────────────────────────────────────────────────────────────────────
describe('RST — restart', () => {
  it('RST 7 jumps to address 38H and returns', () => {
    // Place a handler at 38H that sets A=42H then RET
    const r = run([
      'ORG 0038H',
      'MVI A, 42H',
      'RET',
      'ORG 0100H',
      'LXI SP, 2000H',
      'RST 7',
      'HLT',
    ].join('\n'));
    expect(r.a).toBe(0x42);
  });
});

// ── LED display (CALL 5 syscall) ─────────────────────────────────────────────
describe('LED display via CALL 5', () => {
  it('C=02H syscall updates LED display', () => {
    simInit();
    // CALL 5 with C=02H: displays numTo7Seg([HL]) on LED f=B
    // Data byte at 0x200, written after assembly so it survives the RAM reset
    simAssemble([
      'ORG 100H',
      'LXI SP, 2000H',
      'MVI C, 02H',
      'MVI B, 00H',
      'LXI H, 0200H',
      'CALL 0005H',
      'HLT',
    ].join('\n'));
    simWriteByte(0x200, 0x01); // write data AFTER assembly
    while (simIsRunning()) simStep();
    const leds = simGetAllLeds();
    expect(leds[0]).not.toBe(0); // LED 0 was written via syscall
  });
});
