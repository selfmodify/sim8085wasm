export const hex2 = n => (n >>> 0 & 0xFF).toString(16).toUpperCase().padStart(2,'0')
export const hex4 = n => (n >>> 0 & 0xFFFF).toString(16).toUpperCase().padStart(4,'0')

export const b64encode = str => btoa(Array.from(new TextEncoder().encode(str), b => String.fromCharCode(b)).join(''))
export const b64decode = b64 => { try { return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))) } catch { return null } }

export const BASE_CYCLE = ['hex', 'dec', 'bin']

export const SPEEDS = [
  { label:'Crawl',   steps:       1 },
  { label:'Slow',    steps:      20 },
  { label:'Med',     steps:     200 },
  { label:'Fast',    steps:    1000 },
  { label:'Turbo',   steps:  100000 },
  { label:'Turbo+',  steps:  1000000 },
  { label:'Warp',    steps:        0, warp: true },
]

export function fmtByte(v, base) {
  if (base === 'dec') return String(v)
  if (base === 'bin') return v.toString(2).padStart(8, '0')
  return hex2(v)
}

export function fmtWord(v, base) {
  if (base === 'dec') return String(v)
  if (base === 'bin') return v.toString(2).padStart(16, '0')
  return hex4(v)
}

export const TRACE_REG16 = new Set(['pc','sp'])
export const fmtTraceVal = (k, v) => TRACE_REG16.has(k) ? hex4(v) : hex2(v)

export function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(0) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k'
  return String(n)
}

export function evalCondition(expr, r) {
  try {
    const BC = (r.b<<8)|r.c, DE = (r.d<<8)|r.e, HL = (r.h<<8)|r.l
    const S = (r.flags>>7)&1, Z = (r.flags>>6)&1, AC = (r.flags>>4)&1, P = (r.flags>>2)&1, CY = r.flags&1
    // eslint-disable-next-line no-new-func
    return !!new Function('A','B','C','D','E','H','L','PC','SP','BC','DE','HL','FLAGS','S','Z','AC','P','CY',
      `return !!(${expr})`)(r.a,r.b,r.c,r.d,r.e,r.h,r.l,r.pc,r.sp,BC,DE,HL,r.flags,S,Z,AC,P,CY)
  } catch { return true }
}

export const TSTATES = (() => {
  const t = new Uint8Array(256).fill(4)
  for (const op of [0x06,0x0E,0x16,0x1E,0x26,0x2E,0x3E,
                    0xC6,0xCE,0xD6,0xDE,0xE6,0xEE,0xF6,0xFE]) t[op] = 7
  t[0x36]=10; t[0x34]=10; t[0x35]=10           // MVI M / INR M / DCR M
  for (let r=0; r<8; r++) if (r!==6) { t[0x40|(r<<3)|6]=7; t[0x70|r]=7 }
  for (const op of [0x86,0x8E,0x96,0x9E,0xA6,0xAE,0xB6,0xBE]) t[op]=7
  for (const op of [0x01,0x11,0x21,0x31]) t[op]=10
  for (const op of [0x03,0x13,0x23,0x33,0x0B,0x1B,0x2B,0x3B]) t[op]=6
  for (const op of [0x09,0x19,0x29,0x39]) t[op]=10
  for (const op of [0x0A,0x1A,0x02,0x12]) t[op]=7
  t[0x3A]=13; t[0x32]=13; t[0x2A]=16; t[0x22]=16
  for (const op of [0xC5,0xD5,0xE5,0xF5]) t[op]=12
  for (const op of [0xC1,0xD1,0xE1,0xF1]) t[op]=10
  t[0xE3]=16; t[0xF9]=6; t[0xE9]=6
  for (const op of [0xC3,0xC2,0xCA,0xD2,0xDA,0xE2,0xEA,0xF2,0xFA]) t[op]=10
  for (const op of [0xCD,0xC4,0xCC,0xD4,0xDC,0xE4,0xEC,0xF4,0xFC]) t[op]=18
  t[0xC9]=10
  for (const op of [0xC0,0xC8,0xD0,0xD8,0xE0,0xE8,0xF0,0xF8]) t[op]=12
  for (let r=0; r<8; r++) t[0xC7|(r<<3)]=12
  t[0x76]=5; t[0xDB]=10; t[0xD3]=10
  return t
})()
