import { useState, useEffect } from 'react';
import * as sim from './simProxy.js';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2, hex4, fmtByte, fmtWord, BASE_CYCLE } from './utils.js';
import { useSimulator } from './SimulatorContext.jsx';
import { PopoutWindow } from './PopoutWindow.jsx';

const PAIR_DEFS = [
  { name: 'BC', hi: 'b', lo: 'c' },
  { name: 'DE', hi: 'd', lo: 'e' },
  { name: 'HL', hi: 'h', lo: 'l' },
]

export function PairPanel({ regs, prev, onJump, onMemoryEdited, dragHandleProps, dropTargetProps, isDragOver, theme, popoutCrtProps }) {
  const { regBase, onRegBase, onEdit } = useSimulator()
  const [collapsed, toggleCollapsed] = useCollapsible('pairs', true)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_pairs_popped_out') === 'true')
  const [editing, setEditing] = useState(null)  // { key, field: 'addr'|'content' }
  const [buf, setBuf] = useState('')
  const p = prev || {}

  useEffect(() => {
    localStorage.setItem('sim8085_pairs_popped_out', String(poppedOut))
  }, [poppedOut])

  function startEdit(key, field, initial) {
    setEditing({ key, field })
    setBuf(initial)
  }

  function commitEdit() {
    if (!editing) return
    const { key, field } = editing
    const def = PAIR_DEFS.find(d => d.name === key)
    if (!def) { setEditing(null); return }
    const addr = (regs[def.hi] << 8) | regs[def.lo]
    const n = parseInt(buf, 16)
    if (!isNaN(n)) {
      if (field === 'addr') {
        sim.simSetRegisters({ [def.hi]: (n >> 8) & 0xFF, [def.lo]: n & 0xFF })
      } else {
        sim.simWriteByte(addr, n & 0xFF)
        onMemoryEdited?.()
      }
      onEdit()
    }
    setEditing(null)
  }

  const content = (
    <div className="panel-anim-body" style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}>
      <div className="pair-col-hdr">
        <span />
        <span>ADDR</span>
        <span>CONTENT</span>
      </div>
      {PAIR_DEFS.map(({ name, hi, lo }) => {
        const val     = (regs[hi] << 8) | regs[lo]
        const prevVal = p[hi] !== undefined ? (p[hi] << 8) | p[lo] : undefined
        const mem     = sim.simGetMemory(val, 1)[0] ?? 0
        const changed = prevVal !== undefined && val !== prevVal
        const editAddr    = editing?.key === name && editing?.field === 'addr'
        const editContent = editing?.key === name && editing?.field === 'content'
        return (
          <div key={name} className={`pair-row${changed ? ' changed' : ''}${regBase === 'bin' ? ' bin' : ''}`}>
            <span className="reg-name">{name}</span>
            {editAddr
              ? <input autoFocus className="reg-edit-input pair-edit-input" value={buf}
                  onChange={e => setBuf(e.target.value.toUpperCase())}
                  onFocus={e => e.target.select()}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key==='Enter') commitEdit(); if (e.key==='Escape') setEditing(null) }} />
              : <span className="pair-addr"
                  onClick={() => { onJump(val & 0xFFF0); startEdit(name, 'addr', hex4(val)) }}
                  title={`${hex4(val)}H — click to edit pair address, jump memory`}>
                  {fmtWord(val, regBase)}
                </span>
            }
            {editContent
              ? <input autoFocus className="reg-edit-input pair-edit-input" value={buf}
                  onChange={e => setBuf(e.target.value.toUpperCase())}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key==='Enter') commitEdit(); if (e.key==='Escape') setEditing(null) }} />
              : <span className="pair-content"
                  onClick={() => startEdit(name, 'content', hex2(mem))}
                  title={`mem[${hex4(val)}H] = ${hex2(mem)}H — click to edit`}>
                  {fmtByte(mem, regBase)}
                </span>
            }
          </div>
        )
      })}
    </div>
  )

  return (
    <>
      <div className={`panel reg-panel${!poppedOut && isDragOver ? ' drag-over' : ''}`} {...(!poppedOut ? dropTargetProps : {})}>
        {poppedOut ? (
          <>
            <div className="panel-hd" {...dragHandleProps}>
              <span><span className="panel-icon">🔗</span>REGISTER PAIRS</span>
              <div className="panel-hd-right">
                <PanelHelp panel="REGISTER PAIRS" />
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text2)', minHeight: 120 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🪟</div>
              <div style={{ fontSize: 12 }}>Opened in another window.</div>
              <button className="btn btn-xs" style={{ marginTop: 12 }} onClick={() => setPoppedOut(false)}>Bring it back</button>
            </div>
          </>
        ) : (
          <>
            <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
              <span><span className="panel-icon">🔗</span>REGISTER PAIRS</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
                  title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
                <PanelHelp panel="REGISTER PAIRS" />
              </div>
              <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
            </div>
            {!collapsed && content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Register Pairs - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel reg-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">🔗</span>REGISTER PAIRS</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
                  title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
                <PanelHelp panel="REGISTER PAIRS" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}