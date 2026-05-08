import { useState } from 'react';
import * as sim from '../simProxy.js';
import { useCopy, useCollapsible } from '../hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtWord, fmtByte, BASE_CYCLE } from '../utils.js';

export function RegPanel({ regs, prev, onJump, regBase, onRegBase, onEdit, onShowDialog, dragHandleProps, dropTargetProps, isDragOver }) {
  const [collapsed, toggleCollapsed] = useCollapsible('reg', false)
  const p = prev || {}

  function EditableRow({ name, val, prevVal, regKey, is16 }) {
    const [editing, setEditing] = useState(false)
    const [buf, setBuf] = useState('')
    const [copied, copy] = useCopy()
    const changed = prevVal !== undefined && val !== prevVal

    function commit() {
      const radix = regBase === 'bin' ? 2 : regBase === 'dec' ? 10 : 16
      const n = parseInt(buf, radix)
      if (!isNaN(n)) {
        if (regKey === 'pc') {
          onShowDialog?.({
            type: 'confirm',
            title: 'Move PC',
            message: `Move instruction pointer to ${hex4(n)}H?\nThe next step will execute from that address.`,
            onConfirm: () => { sim.simSetRegisters({ [regKey]: n }); onEdit(); },
            onCancel: () => setEditing(false)
          })
          return
        }
        sim.simSetRegisters({ [regKey]: n })
        onEdit()
      }
      setEditing(false)
    }

    if (editing) return (
      <div className={`reg-row${is16 ? ' wide' : ''}${changed ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <input autoFocus className="reg-edit-input"
          value={buf} onChange={e => setBuf(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
      </div>
    )
    const displayVal = is16 ? fmtWord(val, regBase) : fmtByte(val, regBase)
    return (
      <div className={`reg-row${is16 ? ' wide clickable' : ' clickable'}${changed ? ' changed' : ''}`}
           title={is16 ? `Jump memory to ${hex4(val)}H  (click to edit, right-click to copy)` : 'Click to edit, right-click to copy'}
           onClick={() => { if (is16) onJump(val & 0xFFF0); setBuf(displayVal); setEditing(true) }}
           onContextMenu={e => { e.preventDefault(); copy(displayVal) }}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{copied !== null ? '✓' : displayVal}</span>
        {regBase === 'hex' && copied === null && <span className="reg-dec">{val}</span>}
      </div>
    )
  }

  // Paired cell: two 8-bit registers side-by-side
  function PairCell({ name, val, prevVal, regKey }) {
    const [editing, setEditing] = useState(false)
    const [buf, setBuf] = useState('')
    const [copied, copy] = useCopy()
    const changed = prevVal !== undefined && val !== prevVal

    function commit() {
      const radix = regBase === 'bin' ? 2 : regBase === 'dec' ? 10 : 16
      const n = parseInt(buf, radix)
      if (!isNaN(n)) { sim.simSetRegisters({ [regKey]: n }); onEdit() }
      setEditing(false)
    }

    if (editing) return (
      <div className={`reg-pair-cell${changed ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <input autoFocus className="reg-edit-input reg-pair-input"
          value={buf} onChange={e => setBuf(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
      </div>
    )
    const displayVal = fmtByte(val, regBase)
    return (
      <div className={`reg-pair-cell clickable${changed ? ' changed' : ''}`}
           title="Click to edit, right-click to copy"
           onClick={() => { setBuf(displayVal); setEditing(true) }}
           onContextMenu={e => { e.preventDefault(); copy(displayVal) }}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{copied !== null ? '✓' : displayVal}</span>
        {regBase === 'hex' && copied === null && <span className="reg-dec">{val}</span>}
      </div>
    )
  }

  const nextBase = BASE_CYCLE[(BASE_CYCLE.indexOf(regBase) + 1) % 3]

  return (
    <div className={`panel reg-panel${isDragOver ? ' drag-over' : ''}`} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span className="panel-icon">🧠</span>REGISTERS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <button className="reg-base-btn" onClick={() => onRegBase(nextBase)}
            title="Toggle display: hex / dec / bin">{regBase.toUpperCase()}</button>
          <PanelHelp panel="REGISTERS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <>
        <EditableRow name="A" val={regs.a} prevVal={p.a} regKey="a" />
        <div className="reg-bits">
          {[7,6,5,4,3,2,1,0].map(bit => (
            <div key={bit} className={`reg-bit${(regs.a>>bit)&1 ? ' reg-bit-on' : ''}`}
                 title={`bit ${bit} — click to toggle`}
                 onClick={() => { const v = regs.a ^ (1<<bit); sim.simSetRegisters({a:v}); onEdit() }}>
              <div className="reg-bit-lbl">{bit}</div>
              <div className="reg-bit-val">{(regs.a>>bit)&1}</div>
            </div>
          ))}
        </div>
        <div className="reg-pair-row">
          <PairCell name="B" val={regs.b} prevVal={p.b} regKey="b" />
          <PairCell name="C" val={regs.c} prevVal={p.c} regKey="c" />
        </div>
        <div className="reg-pair-row">
          <PairCell name="D" val={regs.d} prevVal={p.d} regKey="d" />
          <PairCell name="E" val={regs.e} prevVal={p.e} regKey="e" />
        </div>
        <div className="reg-pair-row">
          <PairCell name="H" val={regs.h} prevVal={p.h} regKey="h" />
          <PairCell name="L" val={regs.l} prevVal={p.l} regKey="l" />
        </div>
        <div className="reg-sep" />
        <EditableRow name="PC" val={regs.pc} prevVal={p.pc} regKey="pc" is16 />
        <EditableRow name="SP" val={regs.sp} prevVal={p.sp} regKey="sp" is16 />
      </>}
    </div>
  )
}