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
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

export function evalCondition(expr, r) {
  try {
    const BC = (r.b<<8)|r.c, DE = (r.d<<8)|r.e, HL = (r.h<<8)|r.l
    // eslint-disable-next-line no-new-func
    return !!new Function('A','B','C','D','E','H','L','PC','SP','BC','DE','HL','FLAGS',
      `return !!(${expr})`)(r.a,r.b,r.c,r.d,r.e,r.h,r.l,r.pc,r.sp,BC,DE,HL,r.flags)
  } catch { return true }
}
