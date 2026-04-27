// Generates public/favicon.ico (16x16 + 32x32, PNG-in-ICO) using only Node built-ins.
import { deflateSync } from 'zlib'
import { writeFileSync } from 'fs'

// ── Theme colours ───────────────────────────────────────────────────────────
const BG     = [13,  15,  20,  255]   // #0d0f14
const CHIP   = [26,  30,  43,  255]   // #1a1e2b
const BORDER = [42,  48,  80,  255]   // #2a3050
const GREEN  = [74,  240, 160, 255]   // #4af0a0

// ── 3×5 pixel font  ─────────────────────────────────────────────────────────
const GLYPHS = {
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
}

// ── PNG helpers ─────────────────────────────────────────────────────────────
function crc32(buf) {
  if (!crc32.t) {
    crc32.t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      crc32.t[i] = c
    }
  }
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = crc32.t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const tb = Buffer.from(type, 'ascii')
  const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length)
  const cc = Buffer.allocUnsafe(4); cc.writeUInt32BE(crc32(Buffer.concat([tb, data])))
  return Buffer.concat([lb, tb, data, cc])
}

function makePNG(W, H, drawFn) {
  const px = new Uint8Array(W * H * 4)
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = (y * W + x) * 4
    px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a
  }
  drawFn(set)

  // raw scanline data (filter byte 0 = None per row)
  const raw = Buffer.allocUnsafe(H * (1 + W * 4))
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = y * (1 + W * 4) + 1 + x * 4
      raw[d] = px[s]; raw[d+1] = px[s+1]; raw[d+2] = px[s+2]; raw[d+3] = px[s+3]
    }
  }

  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Draw function (works at any size, scales "85" to fit) ───────────────────
function draw(set, W, H) {
  // background
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      set(x, y, ...BG)

  // chip body
  for (let y = 1; y < H-1; y++)
    for (let x = 1; x < W-1; x++)
      set(x, y, ...CHIP)

  // 1-px border
  for (let x = 1; x < W-1; x++) { set(x, 1, ...BORDER); set(x, H-2, ...BORDER) }
  for (let y = 1; y < H-1; y++) { set(1, y, ...BORDER); set(W-2, y, ...BORDER) }

  // "85" centred, scaled to fit
  const scale   = W >= 24 ? 2 : 1
  const charW   = 3 * scale
  const charH   = 5 * scale
  const gap     = scale
  const totalW  = 2 * charW + gap
  const ox      = Math.round((W - totalW) / 2)
  const oy      = Math.round((H - charH) / 2)

  ;['8', '5'].forEach((ch, ci) => {
    GLYPHS[ch].forEach((row, ry) => {
      for (let b = 0; b < 3; b++) {
        if (!(row & (1 << (2 - b)))) continue
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            set(ox + ci*(charW+gap) + b*scale + sx, oy + ry*scale + sy, ...GREEN)
      }
    })
  })
}

const png32 = makePNG(32, 32, (s) => draw(s, 32, 32))
const png16 = makePNG(16, 16, (s) => draw(s, 16, 16))

// ── ICO container ───────────────────────────────────────────────────────────
const HDR_SIZE   = 6
const ENTRY_SIZE = 16
const NUM        = 2
const dataOffset = HDR_SIZE + NUM * ENTRY_SIZE   // 38

const hdr = Buffer.allocUnsafe(6)
hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(NUM, 4)

function dirEntry(sz, png, off) {
  const e = Buffer.allocUnsafe(16)
  e[0] = sz; e[1] = sz; e[2] = 0; e[3] = 0
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(png.length, 8); e.writeUInt32LE(off, 12)
  return e
}

const ico = Buffer.concat([
  hdr,
  dirEntry(32, png32, dataOffset),
  dirEntry(16, png16, dataOffset + png32.length),
  png32,
  png16,
])

writeFileSync('public/favicon.ico', ico)
console.log(`favicon.ico  ${ico.length} bytes  (32x32 + 16x16 PNG-in-ICO)`)
