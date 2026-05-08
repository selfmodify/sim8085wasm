import { useState } from 'react';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4 } from './utils.js';

export function InterruptPanel({ intState, onAssert, onDeassert, dragHandleProps, dropTargetProps, isDragOver }) {
  const [collapsed, toggleCollapsed] = useCollapsible('interrupts', true)
  const { iff, intMask, rst75ff, trapPend, rst65, rst55, intr } = intState
  const [intrRst, setIntrRst] = useState(7)

  const masked = bit => (intMask >> bit) & 1

  const rows = [
    { type:'TRAP',  label:'TRAP',    vec:'0024H', pulse:true,  bit:-1 },
    { type:'RST75', label:'RST 7.5', vec:'003CH', pulse:true,  bit:2  },
    { type:'RST65', label:'RST 6.5', vec:'0034H', pulse:false, bit:1  },
    { type:'RST55', label:'RST 5.5', vec:'002CH', pulse:false, bit:0  },
  ]
  const lineOn = { TRAP: trapPend, RST75: rst75ff, RST65: rst65, RST55: rst55, INTR: intr }

  return (
    <div className={`panel int-panel${isDragOver ? ' drag-over' : ''}`} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span className="panel-icon">🔔</span>INTERRUPTS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="INTERRUPTS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <div className="panel-anim-body">
        <div className="int-iff">
          IFF <span className={`int-iff-val${iff ? ' int-iff-on' : ''}`}>{iff ? 'ENABLED' : 'DISABLED'}</span>
        </div>
        {rows.map(({ type, label, vec, pulse, bit }) => (
          <div key={type} className="int-row">
            {pulse
              ? <button className={`btn btn-xs int-btn${lineOn[type] ? ' int-pending' : ''}`} aria-label={`${lineOn[type] ? 'Pending' : 'Fire'} ${label} interrupt`} onClick={() => onAssert(type)}>{lineOn[type] ? 'PEND' : 'FIRE'}</button>
              : <button className={`btn btn-xs int-btn${lineOn[type] ? ' int-btn-on' : ''}`} aria-label={`${label} interrupt: ${lineOn[type] ? 'ON — click to deassert' : 'OFF — click to assert'}`} onClick={() => lineOn[type] ? onDeassert(type) : onAssert(type)}>{lineOn[type] ? 'ON' : 'OFF'}</button>
            }
            <span className={`int-label${bit >= 0 && masked(bit) ? ' int-masked' : ''}`}>{label}</span>
            <span className="int-vec">{vec}</span>
            {bit >= 0 && masked(bit) && <span className="int-mask-tag">masked</span>}
          </div>
        ))}
        <div className="int-row">
          <button className={`btn btn-xs int-btn${intr ? ' int-btn-on' : ''}`} onClick={() => intr ? onDeassert('INTR') : onAssert('INTR', 0xC7 | (intrRst << 3))}>{intr ? 'ON' : 'OFF'}</button>
          <span className="int-label">INTR</span>
          <span className="int-vec">RST&nbsp;<select className="int-rst-sel" value={intrRst} onChange={e => setIntrRst(+e.target.value)}>{[0,1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n} ({hex4(n*8)}H)</option>)}</select></span>
        </div>
      </div>}
    </div>
  )
}