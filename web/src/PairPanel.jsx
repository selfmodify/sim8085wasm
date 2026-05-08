import { useState } from 'react';
import * as sim from './simProxy.js';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2, hex4, fmtByte, fmtWord, BASE_CYCLE } from './utils.js';
import { useSimulator } from './SimulatorContext.jsx';

const PAIR_DEFS = [
  { name: 'BC', hi: 'b', lo: 'c' },
  { name: 'DE', hi: 'd', lo: 'e' },
  { name: 'HL', hi: 'h', lo: 'l' },
]

export function PairPanel({ regs, prev, onJump, onMemoryEdited, dragHandleProps, dropTargetProps, isDragOver }) {
  const { regBase, onRegBase, onEdit } = useSimulator()
  const [collapsed, toggleCollapsed] = useCollapsible('pairs', true)
  const [editing, setEditing] = useState(null)  // { key, field: 'addr'|'content' }
  const [buf, setBuf] = useState('')
  const p = prev || {}

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

  return (
    <div className={`panel reg-panel${isDragOver ? ' drag-over' : ''}`} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span className="panel-icon">🔗</span>REGISTER PAIRS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="REGISTER PAIRS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <div className="panel-anim-body"><div className="pair-col-hdr">
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
      })}</div>}
    </div>
  )
}