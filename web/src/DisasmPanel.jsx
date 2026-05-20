import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as sim from './simProxy.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtCount } from './utils.js';
import { PopoutWindow } from './PopoutWindow.jsx';

export function DisasmPanel({ regs, breakpoints, onToggleBp, onClearAllBps, onSetCondition, onGotoLine, buildId, pcFlash, onRunTo, symbols, onJumpMem, hitcnts, maxHit, flashReq, addrLineMap, theme, popoutCrtProps }) {
  const [viewStart, setViewStart] = useState(() => regs.pc)
  const [ctxMenu, setCtxMenu]     = useState(null)   // {addr, x, y}
  const [followPC, setFollowPC]   = useState(true)
  const [addrInput, setAddrInput] = useState('')
  const [showBpList, setShowBpList] = useState(false)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_disasm_popped_out') === 'true')
  const curRowRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('sim8085_disasm_popped_out', String(poppedOut))
  }, [poppedOut])

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
  const addrIdxRef  = useRef([])
  const ignorePcScrollRef = useRef(false)
  useEffect(() => { linesRef.current = lines }, [lines])

  const localMaxHitRef = useRef(0)

  useEffect(() => {
    const idx = []
    let addr = 0
    while (addr <= 0xFFFF) { idx.push(addr); const d = sim.simDisassemble(addr); addr += Math.max(1, d.len) }
    addrIdxRef.current = idx
    localMaxHitRef.current = 0
  }, [buildId])

  const findIdx = useCallback((addr) => {
    const idx = addrIdxRef.current
    let lo = 0, hi = idx.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (idx[mid] <= addr) lo = mid; else hi = mid - 1 }
    return lo
  }, [])

  useEffect(() => { setViewStart(regs.pc) }, [buildId])

  useEffect(() => {
    if (!followPC) return
    const ls = linesRef.current
    if (!ls.length) return
    const lo = ls[0].addr
    const hi = ls[ls.length - 1].addr
    if (regs.pc >= lo && regs.pc <= hi) {
      if (!ignorePcScrollRef.current || (regs.pc < lo + 2 || regs.pc > hi - 2)) curRowRef.current?.scrollIntoView({ block: 'nearest' })
    } else if (regs.pc > hi && regs.pc - hi <= 6) {
      setViewStart(vs => { const i = findIdx(vs); return addrIdxRef.current[Math.min(addrIdxRef.current.length - 1, i + 1)] })
    } else {
      setViewStart(regs.pc)
    }
  }, [regs.pc, followPC])

  useEffect(() => {
    if (flashReq && flashReq.addr !== undefined) {
      setFollowPC(false)
      ignorePcScrollRef.current = true
      
      const isVisible = linesRef.current.some(r => r.addr === flashReq.addr)
      if (!isVisible) {
        const targetIdx = findIdx(flashReq.addr)
        const startIdx = Math.max(0, targetIdx - 5)
        setViewStart(addrIdxRef.current[startIdx] ?? flashReq.addr)
      }

      let retries = 0
      const tryHighlight = () => {
        const row = document.querySelector(`.disasm-row[data-addr="${flashReq.addr}"]`)
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' })
          row.classList.remove('flash-highlight')
          void row.offsetWidth
          row.classList.add('flash-highlight')
        } else if (retries < 15) {
          retries++
          setTimeout(tryHighlight, 50)
        }
      }
      setTimeout(tryHighlight, 10)
    }
  }, [flashReq, findIdx])

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
        ignorePcScrollRef.current = true
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const bpList = useMemo(() => [...breakpoints.keys()].sort((a,b) => a-b), [breakpoints])

  const headerRight = (
    <>
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
    </>
  )

  const content = (
    <>
      <div className="disasm-list" ref={listRef} style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}
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
          
          const hit = hitcnts?.has(row.addr) ? hitcnts.get(row.addr) : ((typeof sim.simGetHitCount === 'function' ? sim.simGetHitCount(row.addr) : (typeof sim._sim_get_hitcnt === 'function' ? sim._sim_get_hitcnt(row.addr) : 0)) || 0)
          if (hit > localMaxHitRef.current) localMaxHitRef.current = hit
          const currentMax = Math.max(maxHit || 0, localMaxHitRef.current)
          const hasHit = currentMax > 0 && hit > 0

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
              data-addr={row.addr}
              onClick={() => onGotoLine?.(row.addr)}
              onContextMenu={e => { 
                e.preventDefault(); 
                setCtxMenu({ 
                  addr: row.addr, 
                  x: Math.min(e.clientX, window.innerWidth - 180), 
                  y: Math.min(e.clientY, window.innerHeight - 150) 
                }) 
              }}
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
                title={hasHit ? `${hit.toLocaleString()} hits` : undefined}
                style={{opacity: hasHit ? Math.max(0.15, hit / currentMax) : 0}} />
              <span className="disasm-text">
                {(() => {
                  if (!cur) return row.text;
                  const m = row.text.match(/^([0-9A-Fa-f]{4}\s+(?:[0-9A-Fa-f]{2}\s+)+[a-zA-Z0-9_]+)(\s+)(.+)$/);
                  if (m) return <>{m[1]}{m[2]}<span style={{ color: 'var(--amber)', fontWeight: 600 }}>{m[3]}</span></>;
                  return row.text;
                })()}
              </span>
              {cond && bp && <span className="disasm-cond">{cond}</span>}
              {row.cycles > 0 && <span className="disasm-cycles">{row.cycles}T</span>}
              <span className="disasm-hitcnt" title={hasHit ? "Execution count" : undefined}>
                {hasHit ? fmtCount(hit) : ''}
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
                    <button className="bp-list-del" title={cond ? 'Edit condition' : 'Set condition'}
                      onClick={() => onSetCondition?.(addr)}>◆</button>
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
          {addrLineMap?.has(ctxMenu.addr) && (
            <button className="ctx-menu-item" onClick={() => { onGotoLine?.(ctxMenu.addr); setCtxMenu(null) }}>
              ✏️ Go to source
            </button>
          )}
          <button className="ctx-menu-item" onClick={() => { onJumpMem?.(ctxMenu.addr); setCtxMenu(null) }}>
            💾 Jump to memory location
          </button>
          <button className="ctx-menu-item" onClick={() => { onRunTo?.(ctxMenu.addr); setCtxMenu(null) }}>
            ▶ Run to {hex4(ctxMenu.addr)}H
          </button>
          <button className="ctx-menu-item" onClick={() => { onToggleBp(ctxMenu.addr); setCtxMenu(null) }}>
            {breakpoints.has(ctxMenu.addr) ? '○ Remove BP' : '● Set BP'}
          </button>
          {breakpoints.has(ctxMenu.addr) && (
            <button className="ctx-menu-item" onClick={() => { onSetCondition?.(ctxMenu.addr); setCtxMenu(null) }}>
              {breakpoints.get(ctxMenu.addr) ? '◆ Edit condition…' : '◇ Set condition…'}
            </button>
          )}
        </div>
      )}
    </>
  )

  return (
    <>
      <div className="panel disasm-panel">
        {poppedOut ? (
          <>
            <div className="panel-hd">
              <span><span className="panel-icon">📋</span>DISASSEMBLY</span>
              <div className="panel-hd-right">
                <PanelHelp panel="DISASSEMBLY" />
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text2)' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🪟</div>
              <div style={{ fontSize: 12 }}>Opened in another window.</div>
              <button className="btn btn-xs" style={{ marginTop: 12 }} onClick={() => setPoppedOut(false)}>Bring it back</button>
            </div>
          </>
        ) : (
          <>
            <div className="panel-hd">
              <span><span className="panel-icon">📋</span>DISASSEMBLY</span>
              <div className="panel-hd-right">
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                {headerRight}
              </div>
            </div>
            {content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Disassembly - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel disasm-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">📋</span>DISASSEMBLY</span>
              <div className="panel-hd-right">
                {headerRight}
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}