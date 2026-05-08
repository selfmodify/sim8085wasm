import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as sim from './simProxy.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtCount } from './utils.js';

export function DisasmPanel({ regs, breakpoints, onToggleBp, onClearAllBps, onSetCondition, onGotoLine, buildId, pcFlash, onRunTo, symbols, onJumpMem, hitcnts, maxHit }) {
  const [viewStart, setViewStart] = useState(() => regs.pc)
  const [ctxMenu, setCtxMenu]     = useState(null)   // {addr, x, y}
  const [followPC, setFollowPC]   = useState(true)
  const [addrInput, setAddrInput] = useState('')
  const [showBpList, setShowBpList] = useState(false)
  const curRowRef = useRef(null)

  const addrToLabel = useMemo(() => {
    const m = new Map()
    for (const [name, addr] of Object.entries(symbols || {})) m.set(addr, name)
    return m
  }, [symbols])

  const lines = useMemo(() => {
    const out = []
    let addr = viewStart
    for (let i = 0; i < 100 && addr <= 0xFFFF; i++) {
      const d = sim.simDisassemble(addr)
      out.push({ addr, ...d })
      addr += Math.max(1, d.len)
    }
    return out
  }, [viewStart, buildId])

  const hoveredRef  = useRef(false)
  const listRef     = useRef(null)
  const linesRef    = useRef(lines)
  const addrIdxRef  = useRef([])  // complete instruction address table, rebuilt on each build
  const ignorePcScrollRef = useRef(false)
  useEffect(() => { linesRef.current = lines }, [lines])

  // Build a complete address index by scanning all memory from 0 on each build.
  // Uninitialized RAM is 0x00 (NOP, 1 byte) so alignment from address 0 is always correct.
  useEffect(() => {
    const idx = []
    let addr = 0
    while (addr <= 0xFFFF) { idx.push(addr); const d = sim.simDisassemble(addr); addr += Math.max(1, d.len) }
    addrIdxRef.current = idx
  }, [buildId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Binary search: largest table index whose address value <= addr
  const findIdx = useCallback((addr) => {
    const idx = addrIdxRef.current
    let lo = 0, hi = idx.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (idx[mid] <= addr) lo = mid; else hi = mid - 1 }
    return lo
  }, [])

  useEffect(() => { setViewStart(regs.pc) }, [buildId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!followPC) return
    const ls = linesRef.current
    if (!ls.length) return
    const lo = ls[0].addr
    const hi = ls[ls.length - 1].addr
    if (regs.pc >= lo && regs.pc <= hi) {
      // Only scroll if PC is not already fully visible (e.g., if it's at the very edge)
      // or if ignorePcScrollRef is false (meaning user hasn't scrolled manually)
      if (!ignorePcScrollRef.current || (regs.pc < lo + 2 || regs.pc > hi - 2)) curRowRef.current?.scrollIntoView({ block: 'nearest' })
    } else if (regs.pc > hi && regs.pc - hi <= 6) {
      setViewStart(vs => { const i = findIdx(vs); return addrIdxRef.current[Math.min(addrIdxRef.current.length - 1, i + 1)] })
    } else {
      setViewStart(regs.pc)
    }
  }, [regs.pc, followPC]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

  useEffect(() => {
    const handler = (e) => {
      if (!hoveredRef.current || listRef.current === null) return
      const ls = linesRef.current
      const idx = addrIdxRef.current
      if (idx.length === 0) return

      const step = (vs, delta) => {
        const i = findIdx(vs)
        return idx[Math.max(0, Math.min(idx.length - 1, i + delta))]
      }
      const pageRows = listRef.current ? Math.max(1, Math.floor(listRef.current.clientHeight / 20) - 1) : 15

      // Detect manual scrolling and disable followPC
      let manualScroll = false
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setViewStart(vs => step(vs, 1)); manualScroll = true
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setViewStart(vs => step(vs, -1)); manualScroll = true
      } else if (e.key === 'PageDown') {
        e.preventDefault(); setViewStart(vs => step(vs, pageRows)); manualScroll = true
      } else if (e.key === 'PageUp') {
        e.preventDefault(); setViewStart(vs => step(vs, -pageRows)); manualScroll = true
      } else if (e.key === 'Home') {
        e.preventDefault(); setViewStart(0); manualScroll = true
      } else if (e.key === 'End') {
        e.preventDefault(); setViewStart(idx[idx.length - 1] || 0xFF00); manualScroll = true
      }
      if (manualScroll) {
        setFollowPC(false)
        ignorePcScrollRef.current = true // Indicate user is actively scrolling
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const bpList = useMemo(() => [...breakpoints.keys()].sort((a,b) => a-b), [breakpoints])

  return (
    <div className="panel disasm-panel">
      <div className="panel-hd">
        <span className="panel-icon">📋</span>DISASSEMBLY
        <div className="panel-hd-right">
          <input className="disasm-addr-input" placeholder="addr" value={addrInput}
            onChange={e => setAddrInput(e.target.value.toUpperCase())}
            onFocus={e => e.target.select()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = parseInt(addrInput, 16)
                if (!isNaN(v)) { setViewStart(v & 0xFFFF); setFollowPC(false) }
                setAddrInput(''); ignorePcScrollRef.current = true
              }
              if (e.key === 'Escape') setAddrInput('')
            }}
            title="Jump to hex address (Enter)" />
          <button className={`reg-base-btn${followPC ? ' active' : ''}`}
            onClick={() => setFollowPC(f => !f)}
            title={followPC ? 'Following PC — click to unlock' : 'Not following PC — click to lock'}>
            {followPC ? 'PC↓' : 'PC·'}
          </button>
          <PanelHelp panel="DISASSEMBLY" />
        </div>
      </div>
      <div className="disasm-list" ref={listRef}
        onWheel={e => {
          if (!listRef.current) return
          const idx = addrIdxRef.current
          if (idx.length === 0) return
          
          setFollowPC(false)
          ignorePcScrollRef.current = true

          const { scrollTop, scrollHeight, clientHeight } = listRef.current
          if (e.deltaY < 0 && scrollTop <= 1) {
            e.preventDefault()
            setViewStart(vs => idx[Math.max(0, findIdx(vs) - 3)])
          } else if (e.deltaY > 0 && scrollTop + clientHeight >= scrollHeight - 1) {
            e.preventDefault()
            setViewStart(vs => idx[Math.min(idx.length - 1, findIdx(vs) + 3)])
          }
        }}
        onMouseEnter={() => { hoveredRef.current = true }}
        onMouseLeave={() => { hoveredRef.current = false }}>
        {lines.map(row => {
          const cur   = row.addr === regs.pc
          const bp    = breakpoints.has(row.addr)
          const cond  = breakpoints.get(row.addr) ?? null
          const label = addrToLabel.get(row.addr)
          return (
            <div key={cur ? `cur-${regs.pc}-${pcFlash}` : row.addr}>
            {label && (
              <div className="disasm-label"
                onClick={() => { onJumpMem?.(row.addr & 0xFFF0); onGotoLine?.(row.addr, label) }}
                title={`${label}: at ${hex4(row.addr)}H — click to jump memory + editor`}>
                {label}:
              </div>
            )}
            <div
              ref={cur ? curRowRef : null}
              className={`disasm-row${cur ? ' cur' : ''}${bp ? ' bp' : ''}${row.mnem === 'ASSERT' ? ' assert' : ''}`}
              onClick={() => onGotoLine?.(row.addr)}
              onContextMenu={e => { e.preventDefault(); setCtxMenu({ addr: row.addr, x: e.clientX, y: e.clientY }) }}
            >
              <span className="disasm-bp"
                role="button"
                aria-label={bp ? (cond ? `Conditional breakpoint at ${hex4(row.addr)}H` : `Breakpoint at ${hex4(row.addr)}H — click to remove`) : `Set breakpoint at ${hex4(row.addr)}H`}
                title={bp ? (cond ? `Condition: ${cond} — right-click to edit` : 'Breakpoint — right-click to add condition') : 'Click to set breakpoint'}
                onClick={e => { e.stopPropagation(); onToggleBp(row.addr) }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); bp && onSetCondition?.(row.addr) }}
              >
                {bp ? (cond ? '◆' : '●') : '·'}
              </span>
              <span className="disasm-heat"
                title={maxHit > 0 && hitcnts?.has(row.addr) ? `${hitcnts.get(row.addr).toLocaleString()} hits` : undefined}
                style={{opacity: maxHit > 0 && hitcnts?.has(row.addr) ? Math.max(0.15, hitcnts.get(row.addr) / maxHit) : 0}} />
              <span className="disasm-text">{row.text}</span>
              {cond && bp && <span className="disasm-cond">{cond}</span>}
              {row.cycles > 0 && <span className="disasm-cycles">{row.cycles}T</span>}
              <span className="disasm-hitcnt" title={maxHit > 0 && hitcnts?.has(row.addr) ? "Execution count" : undefined}>
                {maxHit > 0 && hitcnts?.has(row.addr) ? fmtCount(hitcnts.get(row.addr)) : ''}
              </span>
              {cur && <span className="disasm-pc-arrow">◀</span>}
            </div>
            </div>
          )
        })}
      </div>

      {bpList.length > 0 && (
        <div className="bp-list-wrap">
          <div className="bp-list-hd" onClick={() => setShowBpList(s => !s)}>
            <span>● BREAKPOINTS ({bpList.length})</span>
            <span style={{display:'flex', alignItems:'center', gap:6}}>
              <button className="bp-list-del" title="Clear all breakpoints"
                onClick={e => { e.stopPropagation(); onClearAllBps() }}
                style={{fontSize:10, padding:'1px 6px'}}>✕ All</button>
              {showBpList ? '▴' : '▾'}
            </span>
          </div>
          {showBpList && (
            <div className="bp-list">
              {bpList.map(addr => {
                const cond = breakpoints.get(addr)
                return (
                  <div key={addr} className="bp-list-row">
                    <span className="bp-list-addr"
                      onClick={() => { setViewStart(addr); setFollowPC(false) }}
                      title="Click to jump disassembly here">
                      {hex4(addr)}H
                    </span>
                    {cond && <span className="bp-list-cond" title={cond}>{cond}</span>}
                    <button className="bp-list-del" title="Remove breakpoint"
                      onClick={() => onToggleBp(addr)}>✕</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}>
          <button className="ctx-menu-item" onClick={() => { onRunTo?.(ctxMenu.addr); setCtxMenu(null) }}>
            ▶ Run to {hex4(ctxMenu.addr)}H
          </button>
          <button className="ctx-menu-item" onClick={() => { onToggleBp(ctxMenu.addr); setCtxMenu(null) }}>
            {breakpoints.has(ctxMenu.addr) ? '○ Remove BP' : '● Set BP'}
          </button>
        </div>
      )}
    </div>
  )
}