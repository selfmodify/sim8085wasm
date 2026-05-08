import { describe, it, expect } from 'vitest';
import {
  hex2, hex4, fmtByte, fmtWord, fmtCount, fmtTraceVal,
  b64encode, b64decode, evalCondition, BASE_CYCLE, SPEEDS,
} from './utils.js';

// ── hex2 ─────────────────────────────────────────────────────────────────────
describe('hex2', () => {
  it('formats zero', () => expect(hex2(0)).toBe('00'));
  it('formats single digit', () => expect(hex2(10)).toBe('0A'));
  it('formats max byte', () => expect(hex2(255)).toBe('FF'));
  it('masks to 8 bits (256 → 00)', () => expect(hex2(256)).toBe('00'));
  it('masks to 8 bits (257 → 01)', () => expect(hex2(257)).toBe('01'));
  it('uppercase output', () => expect(hex2(0xAB)).toBe('AB'));
});

// ── hex4 ─────────────────────────────────────────────────────────────────────
describe('hex4', () => {
  it('formats zero', () => expect(hex4(0)).toBe('0000'));
  it('pads low values', () => expect(hex4(255)).toBe('00FF'));
  it('formats max word', () => expect(hex4(65535)).toBe('FFFF'));
  it('formats mid value', () => expect(hex4(0x1234)).toBe('1234'));
  it('masks to 16 bits (65536 → 0000)', () => expect(hex4(65536)).toBe('0000'));
  it('uppercase output', () => expect(hex4(0xABCD)).toBe('ABCD'));
});

// ── fmtByte ──────────────────────────────────────────────────────────────────
describe('fmtByte', () => {
  it('hex: pads to 2 chars', () => expect(fmtByte(10, 'hex')).toBe('0A'));
  it('hex: 0 → 00', () => expect(fmtByte(0, 'hex')).toBe('00'));
  it('hex: 255 → FF', () => expect(fmtByte(255, 'hex')).toBe('FF'));
  it('dec: plain number string', () => expect(fmtByte(10, 'dec')).toBe('10'));
  it('dec: 0 → 0', () => expect(fmtByte(0, 'dec')).toBe('0'));
  it('bin: pads to 8 chars', () => expect(fmtByte(10, 'bin')).toBe('00001010'));
  it('bin: 0 → 00000000', () => expect(fmtByte(0, 'bin')).toBe('00000000'));
  it('bin: 255 → 11111111', () => expect(fmtByte(255, 'bin')).toBe('11111111'));
  it('defaults to hex when base is unknown', () => expect(fmtByte(0xAB, 'bogus')).toBe('AB'));
});

// ── fmtWord ──────────────────────────────────────────────────────────────────
describe('fmtWord', () => {
  it('hex: pads to 4 chars', () => expect(fmtWord(0x00FF, 'hex')).toBe('00FF'));
  it('hex: 0 → 0000', () => expect(fmtWord(0, 'hex')).toBe('0000'));
  it('dec: plain number', () => expect(fmtWord(1234, 'dec')).toBe('1234'));
  it('bin: pads to 16 chars', () => expect(fmtWord(1, 'bin')).toBe('0000000000000001'));
  it('bin: 0 → 16 zeros', () => expect(fmtWord(0, 'bin')).toBe('0000000000000000'));
});

// ── fmtCount ─────────────────────────────────────────────────────────────────
describe('fmtCount', () => {
  it('shows small numbers as-is', () => expect(fmtCount(42)).toBe('42'));
  it('shows 999 as-is', () => expect(fmtCount(999)).toBe('999'));
  it('formats thousands with k', () => expect(fmtCount(1500)).toBe('2k'));
  it('formats exact thousands', () => expect(fmtCount(1000)).toBe('1k'));
  it('formats millions with M', () => expect(fmtCount(1500000)).toBe('2M'));
  it('formats exact million', () => expect(fmtCount(1000000)).toBe('1M'));
  it('prefers M over k above 1e6', () => expect(fmtCount(2000000)).toBe('2M'));
});

// ── fmtTraceVal ──────────────────────────────────────────────────────────────
describe('fmtTraceVal', () => {
  it('uses hex4 for pc', () => expect(fmtTraceVal('pc', 0x1234)).toBe('1234'));
  it('uses hex4 for sp', () => expect(fmtTraceVal('sp', 0xFFFE)).toBe('FFFE'));
  it('uses hex2 for 8-bit register a', () => expect(fmtTraceVal('a', 0xFF)).toBe('FF'));
  it('uses hex2 for register b', () => expect(fmtTraceVal('b', 0x0A)).toBe('0A'));
  it('uses hex2 for flags', () => expect(fmtTraceVal('flags', 0x42)).toBe('42'));
});

// ── b64encode / b64decode ────────────────────────────────────────────────────
describe('b64encode / b64decode', () => {
  it('round-trips ASCII', () => {
    const s = 'MOV A, B\nHLT';
    expect(b64decode(b64encode(s))).toBe(s);
  });
  it('round-trips empty string', () => {
    expect(b64decode(b64encode(''))).toBe('');
  });
  it('round-trips a longer program', () => {
    const s = 'ORG 100H\nMVI A, 42H\nHLT';
    expect(b64decode(b64encode(s))).toBe(s);
  });
  it('b64decode returns null for invalid input', () => {
    expect(b64decode('!!!invalid!!!')).toBeNull();
  });
});

// ── evalCondition ────────────────────────────────────────────────────────────
describe('evalCondition', () => {
  const regs = (overrides = {}) => ({
    a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
    pc: 0x100, sp: 0, flags: 0,
    ...overrides,
  });

  it('evaluates A === 0 as true', () => {
    expect(evalCondition('A === 0', regs())).toBe(true);
  });
  it('evaluates A === 0 as false when A is nonzero', () => {
    expect(evalCondition('A === 0', regs({ a: 1 }))).toBe(false);
  });
  it('evaluates carry flag CY', () => {
    expect(evalCondition('CY', regs({ flags: 0x01 }))).toBe(true);
    expect(evalCondition('CY', regs({ flags: 0x00 }))).toBe(false);
  });
  it('evaluates zero flag Z', () => {
    expect(evalCondition('Z', regs({ flags: 0x40 }))).toBe(true);
    expect(evalCondition('Z', regs({ flags: 0x00 }))).toBe(false);
  });
  it('evaluates register pairs BC', () => {
    expect(evalCondition('BC === 0x1234', regs({ b: 0x12, c: 0x34 }))).toBe(true);
  });
  it('evaluates PC', () => {
    expect(evalCondition('PC >= 0x100', regs({ pc: 0x100 }))).toBe(true);
  });
  it('returns true (safe default) on syntax error', () => {
    expect(evalCondition('this is not valid js !!!', regs())).toBe(true);
  });
});

// ── BASE_CYCLE / SPEEDS ──────────────────────────────────────────────────────
describe('constants', () => {
  it('BASE_CYCLE has three entries in order', () => {
    expect(BASE_CYCLE).toEqual(['hex', 'dec', 'bin']);
  });
  it('SPEEDS has 8 presets', () => {
    expect(SPEEDS).toHaveLength(8);
  });
  it('last SPEEDS entry is warp mode', () => {
    expect(SPEEDS[SPEEDS.length - 1].warp).toBe(true);
  });
});
