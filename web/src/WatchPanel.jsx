import { useState, useEffect, useRef } from 'react';
import * as sim from './simProxy.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtWord, fmtByte, BASE_CYCLE } from './utils.js';
import { useSimulator } from './SimulatorContext.jsx';
import { PopoutWindow } from './PopoutWindow.jsx';

export function WatchPanel({ watches, regs, prevRegs, changedAddrs, onAdd, onRemove, dataBps, onToggleBreak, theme, popoutCrtProps }) {
  const { regBase, onRegBase } = useSimulator()
  const panelRef = useRef(null)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_watch_popped_out') === 'true')
  const [input, setInput] = useState('')
  const PAIR_KEYS = { bc: ['b','c'], de: ['d','e'], hl: ['h','l'] }
  const REG_NAMES = new Set(['a','b','c','d','e','h','l','pc','sp','flags','bc','de','hl'])

  useEffect(() => {
    localStorage.setItem('sim8085_watch_popped_out', String(poppedOut))
  }, [poppedOut])

  function getValue(w) {
    if (w.type === 'reg') {
      const p = PAIR_KEYS[w.key]
      if (p) return (regs[p[0]] << 8) | regs[p[1]]
      return regs[w.key] ?? 0
    }
    return sim.simReadByte(w.addr)
  }

  function is16(w) {
    return w.type === 'mem' || ['pc','sp','bc','de','hl'].includes(w.key)
  }

  function addWatch() {
    const s = input.trim().toLowerCase()
    if (!s) return
    if (REG_NAMES.has(s)) {
      if (!watches.find(w => w.type === 'reg' && w.key === s))
        onAdd({ type: 'reg', key: s })
    } else {
      const addr = parseInt(s.replace(/h$/,''), 16)
      if (!isNaN(addr))
        onAdd({ type: 'mem', addr: addr & 0xFFFF })
    }
    setInput('')
  }

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const targetEl = panelRef.current.closest('.mem-watch-row') || panelRef.current
    const startH = targetEl.getBoundingClientRect().height
    function onMove(ev) {
      targetEl.style.height = Math.max(80, startH + (startY - ev.clientY)) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      localStorage.setItem('sim8085_mem_row_height', targetEl.style.height)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const content = (
    <>
      <div className="watch-add-row">
        <input className="watch-input" value={input} placeholder="A  BC  0200H…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addWatch()} />
        <button className="btn btn-xs" onClick={addWatch}>+</button>
      </div>
      <div className="watch-body" style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}>
        {watches.length === 0
          ? <div className="watch-empty">Type a register or address above</div>
          : watches.map((w, i) => {
              const v = getValue(w)
              const label = w.type === 'reg' ? w.key.toUpperCase() : hex4(w.addr) + 'H'
              const isBrk = w.type === 'mem' && dataBps?.has(w.addr)

              let changed = false
              if (w.type === 'reg' && prevRegs) {
                const p = PAIR_KEYS[w.key]
                if (p) {
                  const prevV = (prevRegs[p[0]] << 8) | prevRegs[p[1]]
                  changed = v !== prevV
                } else {
                  changed = v !== prevRegs[w.key]
                }
              } else if (w.type === 'mem') {
                changed = changedAddrs?.has(w.addr)
              }

              return (
                <div key={w.type === 'reg' ? `reg-${w.key}` : `mem-${w.addr}`} className={`watch-row${changed ? ' changed' : ''}`}>
                  <span className="watch-label">{label}</span>
                  <span className="watch-val">{is16(w) ? fmtWord(v, regBase) : fmtByte(v, regBase)}</span>
                  {(regBase||'hex') === 'hex' && <span className="watch-dec">{v}</span>}
                  {w.type === 'mem' && (
                    <button className={`watch-brk${isBrk ? ' active' : ''}`}
                      title={isBrk ? 'Break on write: ON — click to disable' : 'Break on write: OFF — click to enable'}
                      onClick={() => onToggleBreak?.(w.addr)}>W</button>
                  )}
                  <button className="watch-rm" onClick={() => onRemove(i)}>✕</button>
                </div>
              )
            })
        }
      </div>
    </>
  )

  return (
    <>
      <div className="panel watch-panel" ref={!poppedOut ? panelRef : null}>
        {poppedOut ? (
          <>
            <div className="panel-hd">
              <span><span className="panel-icon">👁</span>WATCH</span>
              <div className="panel-hd-right">
                <PanelHelp panel="WATCH" />
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
            {!poppedOut && <div className="watch-resize-handle" onMouseDown={onResizeDown} />}
            <div className="panel-hd">
              <span><span className="panel-icon">👁</span>WATCH</span>
              <div className="panel-hd-right">
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
                  title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
                <PanelHelp panel="WATCH" />
              </div>
            </div>
            {content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Watch - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel watch-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">👁</span>WATCH</span>
              <div className="panel-hd-right">
                <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
                  title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
                <PanelHelp panel="WATCH" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}