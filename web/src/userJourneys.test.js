/**
 * userJourneys.test.js
 * End-to-end simulator flows through sim8085Bridge.js.
 * Each test represents a realistic user scenario: write a program,
 * assemble it, run/step it, inspect results.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  simInit, simAssemble, simStep, simRun,
  simGetRegisters, simSetRegisters,
  simGetMemory, simReadByte, simWriteByte,
  simIsHalted, simIsRunning,
  simSetBreakpoint, simClearAllBreakpoints,
  simGetOutputPorts, simSetInputPort,
  simGetConsoleOutput, simSetConsolePort, simClearConsoleOutput,
  simGetCycles, simGetAllLeds,
  simSetDataBreakpoint, simClearAllDataBreakpoints, simGetDataWatchHit,
  simGetSymbols, simGetProgramRegion,
} from './sim8085Bridge.js';

beforeEach(() => { simInit(); });

// ── Journey 1: Basic build → run → inspect ───────────────────────────────────
describe('Journey: build, run, inspect registers', () => {
  it('loads a value into A and halts', () => {
    const res = simAssemble('ORG 100H\nMVI A, 42H\nHLT');
    expect(res.ok).toBe(true);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x42);
    expect(simIsHalted()).toBe(true);
  });

  it('performs addition and reads result', () => {
    simAssemble('ORG 100H\nMVI A, 05H\nMVI B, 03H\nADD B\nHLT');
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(8);
  });

  it('performs 16-bit sum via DAD', () => {
    simAssemble('ORG 100H\nLXI H, 1000H\nLXI B, 0500H\nDAD B\nHLT');
    while (simIsRunning()) simStep();
    const r = simGetRegisters();
    expect((r.h << 8) | r.l).toBe(0x1500);
  });
});

// ── Journey 2: Step-by-step execution ────────────────────────────────────────
describe('Journey: single-step through a short program', () => {
  it('steps one instruction at a time and PC advances', () => {
    simAssemble('ORG 100H\nNOP\nNOP\nHLT');
    const pcStart = simGetRegisters().pc;
    expect(pcStart).toBe(0x100);

    simStep();
    expect(simGetRegisters().pc).toBe(0x101);

    simStep();
    expect(simGetRegisters().pc).toBe(0x102);

    simStep(); // HLT
    expect(simIsHalted()).toBe(true);
  });

  it('register values update after each step', () => {
    simAssemble('ORG 100H\nMVI A, 0AH\nMVI B, 05H\nADD B\nHLT');

    simStep(); expect(simGetRegisters().a).toBe(0x0A);
    simStep(); expect(simGetRegisters().b).toBe(0x05);
    simStep(); expect(simGetRegisters().a).toBe(0x0F);
  });
});

// ── Journey 3: Breakpoints ────────────────────────────────────────────────────
describe('Journey: set breakpoint, run to it', () => {
  it('stops at the breakpoint address', () => {
    const src = [
      'ORG 100H',
      'MVI A, 01H',
      'MVI A, 02H',   // addr 0x102
      'MVI A, 03H',   // addr 0x104
      'HLT',
    ].join('\n');
    simAssemble(src);
    simSetBreakpoint(0x104);

    simRun(1000); // simRun checks breakpoints; simStep does not
    // Stopped AT 0x104 before executing it
    expect(simGetRegisters().pc).toBe(0x104);
    expect(simGetRegisters().a).toBe(0x02); // 3rd MVI not yet executed
  });

  it('continues past breakpoint after clearing it', () => {
    simAssemble('ORG 100H\nMVI A, 01H\nMVI A, 02H\nHLT');
    simSetBreakpoint(0x102);

    simRun(1000);
    expect(simGetRegisters().pc).toBe(0x102);

    simClearAllBreakpoints();
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x02);
    expect(simIsHalted()).toBe(true);
  });

  it('does not stop at an address with no breakpoint', () => {
    simAssemble('ORG 100H\nMVI A, 01H\nMVI A, 02H\nHLT');
    simSetBreakpoint(0x200); // elsewhere

    simRun(1000);
    expect(simGetRegisters().a).toBe(0x02);
    expect(simIsHalted()).toBe(true);
  });
});

// ── Journey 4: Memory read/write ──────────────────────────────────────────────
describe('Journey: direct memory editing and reading', () => {
  it('simWriteByte / simReadByte work before assembly', () => {
    simWriteByte(0x200, 0xAB);
    expect(simReadByte(0x200)).toBe(0xAB);
  });

  it('program reads value written to memory', () => {
    simAssemble('ORG 100H\nLDA 0300H\nHLT');
    simWriteByte(0x300, 0x55); // write after assembly — assembly resets RAM
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x55);
  });

  it('program writes value, host reads it back', () => {
    simAssemble('ORG 100H\nMVI A, 0BBH\nSTA 0300H\nHLT');
    while (simIsRunning()) simStep();
    expect(simReadByte(0x300)).toBe(0xBB);
  });

  it('simGetMemory returns a slice of RAM', () => {
    simWriteByte(0x100, 0xAA);
    simWriteByte(0x101, 0xBB);
    const slice = simGetMemory(0x100, 2);
    expect(slice[0]).toBe(0xAA);
    expect(slice[1]).toBe(0xBB);
  });
});

// ── Journey 5: Register editing mid-run ──────────────────────────────────────
describe('Journey: edit registers via simSetRegisters', () => {
  it('injected A value is used by subsequent ADD', () => {
    simAssemble('ORG 100H\nMVI B, 01H\nADD B\nHLT');
    simStep(); // MVI B,01H
    simSetRegisters({ a: 0x10 });
    simStep(); // ADD B → A = 0x10 + 0x01
    expect(simGetRegisters().a).toBe(0x11);
  });

  it('sets PC to restart execution from a different address', () => {
    // Two NOPs then HLT at 0x102; we jump over to MOV A,B at 0x103
    simAssemble('ORG 100H\nNOP\nNOP\nHLT\nMVI A, 0FFH\nHLT');
    simSetRegisters({ pc: 0x103 }); // skip to MVI A, FFH
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0xFF);
  });
});

// ── Journey 6: Assembly error reporting ──────────────────────────────────────
describe('Journey: assembly errors are reported', () => {
  it('returns ok:false and an error message for bad syntax', () => {
    const res = simAssemble('ORG 100H\nMVI BADTOKEN\nHLT');
    expect(res.ok).toBe(false);
    expect(res.errorMsg).toBeTruthy();
  });

  it('resets to runnable state after bad assembly (status=0)', () => {
    simAssemble('GARBAGE ;;; NOT 8085');
    // Failed assembly resets regs/status but has no program — simulator is "ready" not halted
    expect(simIsRunning()).toBe(true);
  });

  it('valid assembly following a failed one works correctly', () => {
    simAssemble('GARBAGE');
    const res = simAssemble('ORG 100H\nMVI A, 07H\nHLT');
    expect(res.ok).toBe(true);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x07);
  });
});

// ── Journey 7: I/O ports ──────────────────────────────────────────────────────
describe('Journey: IN/OUT port I/O', () => {
  it('OUT writes to port and host reads it via simGetOutputPorts', () => {
    simAssemble('ORG 100H\nMVI A, 0CAH\nOUT 10H\nHLT');
    while (simIsRunning()) simStep();
    const ports = simGetOutputPorts(); // returns [{port, val}] sorted array
    const entry = ports.find(p => p.port === 0x10);
    expect(entry?.val).toBe(0xCA);
  });

  it('IN reads value preset by host', () => {
    simSetInputPort(0x05, 0x77);
    simAssemble('ORG 100H\nIN 05H\nHLT');
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(0x77);
  });
});

// ── Journey 8: Console output via OUT ────────────────────────────────────────
describe('Journey: console output', () => {
  it('characters written to console port appear in console output', () => {
    simSetConsolePort(0x01);
    simClearConsoleOutput();
    // Write 'HI' — H=72, I=73
    simAssemble([
      'ORG 100H',
      'MVI A, 48H', // 'H'
      'OUT 01H',
      'MVI A, 49H', // 'I'
      'OUT 01H',
      'HLT',
    ].join('\n'));
    while (simIsRunning()) simStep();
    expect(simGetConsoleOutput()).toBe('HI');
  });

  it('simClearConsoleOutput resets the buffer', () => {
    simSetConsolePort(0x01);
    simAssemble('ORG 100H\nMVI A, 41H\nOUT 01H\nHLT');
    while (simIsRunning()) simStep();
    expect(simGetConsoleOutput()).toBe('A');
    simClearConsoleOutput();
    expect(simGetConsoleOutput()).toBe('');
  });
});

// ── Journey 9: Cycle counting ─────────────────────────────────────────────────
describe('Journey: cycle counting', () => {
  it('NOP costs 4 cycles', () => {
    simAssemble('ORG 100H\nNOP\nHLT');
    simStep(); // NOP
    expect(simGetCycles()).toBe(4);
  });

  it('MVI r,data costs 7 cycles', () => {
    simAssemble('ORG 100H\nMVI A, 00H\nHLT');
    simStep(); // MVI A,00H
    expect(simGetCycles()).toBe(7);
  });

  it('cycles accumulate across instructions', () => {
    simAssemble('ORG 100H\nNOP\nNOP\nHLT');
    simStep(); simStep();
    expect(simGetCycles()).toBe(8); // 4 + 4
  });
});

// ── Journey 10: Data watchpoints ──────────────────────────────────────────────
describe('Journey: data write breakpoints', () => {
  it('stops when watched address is written', () => {
    simAssemble('ORG 100H\nMVI A, 0FFH\nSTA 0300H\nHLT');
    simSetDataBreakpoint(0x300);
    simRun(1000); // simRun stops when dataWatchHit >= 0
    // Stopped after the STA wrote to 0x300 — HLT not yet executed
    expect(simGetDataWatchHit()).toBe(0x300);
    expect(simReadByte(0x300)).toBe(0xFF);
  });

  it('does not stop when unwatched address is written', () => {
    simAssemble('ORG 100H\nMVI A, 0FFH\nSTA 0300H\nHLT');
    simSetDataBreakpoint(0x400); // different address
    simRun(1000);
    expect(simGetDataWatchHit()).toBe(-1);
    expect(simIsHalted()).toBe(true);
  });

  it('clears watchpoints with simClearAllDataBreakpoints', () => {
    simSetDataBreakpoint(0x300);
    simClearAllDataBreakpoints();
    simAssemble('ORG 100H\nMVI A, 01H\nSTA 0300H\nHLT');
    while (simIsRunning()) simStep();
    expect(simIsHalted()).toBe(true);
    expect(simGetDataWatchHit()).toBe(-1);
  });
});

// ── Journey 11: Symbol table ──────────────────────────────────────────────────
describe('Journey: symbol table from assembler', () => {
  it('exports defined labels', () => {
    simAssemble('ORG 100H\nSTART: MVI A, 01H\nDONE: HLT');
    const syms = simGetSymbols();
    expect(syms['START']).toBe(0x100);
    expect(syms['DONE']).toBe(0x102);
  });

  it('exports EQU constants', () => {
    simAssemble('LIMIT EQU 0FFH\nORG 100H\nMVI A, LIMIT\nHLT');
    const syms = simGetSymbols();
    expect(syms['LIMIT']).toBe(0xFF);
  });
});

// ── Journey 12: CALL/RET subroutine flow ─────────────────────────────────────
describe('Journey: subroutine call and return', () => {
  it('CALL jumps to subroutine, RET returns to caller', () => {
    const src = [
      'ORG 100H',
      'MVI B, 00H',
      'CALL MYSUB',
      'HLT',
      'MYSUB: MVI B, 0AAH',
      'RET',
    ].join('\n');
    simAssemble(src);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().b).toBe(0xAA);
  });

  it('nested calls unwind stack correctly', () => {
    const src = [
      'ORG 100H',
      'MVI C, 00H',
      'CALL OUTER',
      'HLT',
      'OUTER: CALL INNER',
      'MVI C, 01H',
      'RET',
      'INNER: MVI C, 02H',
      'RET',
    ].join('\n');
    simAssemble(src);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().c).toBe(0x01); // OUTER ran last
  });
});

// ── Journey 13: PUSH/POP stack usage ─────────────────────────────────────────
describe('Journey: PUSH/POP preserves registers', () => {
  it('saves and restores BC across a subroutine', () => {
    const src = [
      'ORG 100H',
      'LXI B, 1234H',
      'CALL SUB',
      'HLT',
      'SUB: PUSH B',
      'LXI B, 0000H', // clobber BC
      'POP B',        // restore
      'RET',
    ].join('\n');
    simAssemble(src);
    while (simIsRunning()) simStep();
    const r = simGetRegisters();
    expect(r.b).toBe(0x12);
    expect(r.c).toBe(0x34);
  });
});

// ── Journey 14: Loop with conditional branch ─────────────────────────────────
describe('Journey: loop with DCR and JNZ', () => {
  it('counts down from 3 to 0', () => {
    const src = [
      'ORG 100H',
      'MVI B, 03H',
      'LOOP: DCR B',
      'JNZ LOOP',
      'HLT',
    ].join('\n');
    simAssemble(src);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().b).toBe(0x00);
  });

  it('accumulates sum in A via a loop', () => {
    // Sum 1+2+3+4+5 = 15 (0x0F)
    const src = [
      'ORG 100H',
      'MVI A, 00H',
      'MVI C, 05H',
      'MVI B, 01H',
      'LOOP: ADD B',
      'INR B',
      'DCR C',
      'JNZ LOOP',
      'HLT',
    ].join('\n');
    simAssemble(src);
    while (simIsRunning()) simStep();
    expect(simGetRegisters().a).toBe(15);
  });
});

// ── Journey 15: simRun bulk execution ────────────────────────────────────────
describe('Journey: simRun executes multiple steps at once', () => {
  it('halts a simple program with simRun', () => {
    simAssemble('ORG 100H\nMVI A, 0EEH\nHLT');
    simRun(1000);
    expect(simGetRegisters().a).toBe(0xEE);
    expect(simIsHalted()).toBe(true);
  });

  it('simRun respects breakpoints', () => {
    const src = 'ORG 100H\nMVI A, 01H\nMVI A, 02H\nMVI A, 03H\nHLT';
    simAssemble(src);
    simSetBreakpoint(0x104); // before 3rd MVI
    simRun(1000);
    expect(simGetRegisters().a).toBe(0x02);
    expect(simGetRegisters().pc).toBe(0x104);
  });
});
