import { describe, it, expect } from 'vitest';
import { hex2, hex4, fmtByte, fmtWord } from './utils.js';

describe('Utility Formatters', () => {
  it('hex2 correctly pads and formats 8-bit bytes', () => {
    expect(hex2(0)).toBe('00');
    expect(hex2(10)).toBe('0A');
    expect(hex2(255)).toBe('FF');
    // Should safely handle overflows by dropping high bits
    expect(hex2(256)).toBe('00'); 
  });

  it('hex4 correctly pads and formats 16-bit words', () => {
    expect(hex4(0)).toBe('0000');
    expect(hex4(255)).toBe('00FF');
    expect(hex4(65535)).toBe('FFFF');
  });

  it('fmtByte formats bases correctly based on radix', () => {
    expect(fmtByte(10, 'hex')).toBe('0A');
    expect(fmtByte(10, 'dec')).toBe('10');
    expect(fmtByte(10, 'bin')).toBe('00001010');
  });
});