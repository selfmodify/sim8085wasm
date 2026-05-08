import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';

export function FlagPanel({ regs, dragHandleProps, dropTargetProps, isDragOver }) {
  const [collapsed, toggleCollapsed] = useCollapsible('flags', false)
  const FLAGS = [
    { label:'S',  key:'flagS',  title:'Sign — result was negative' },
    { label:'Z',  key:'flagZ',  title:'Zero — result was zero' },
    { label:'AC', key:'flagAC', title:'Auxiliary Carry — carry from bit 3' },
    { label:'P',  key:'flagP',  title:'Parity — even number of 1-bits' },
    { label:'CY', key:'flagCY', title:'Carry — result overflowed' },
  ]
  return (
    <div className={`panel flag-panel${isDragOver ? ' drag-over' : ''}`} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span className="panel-icon">🚩</span>FLAGS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="FLAGS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <div className="panel-anim-body flags-row">
        {FLAGS.map(f => (
          <div key={f.key} className={`flag${regs[f.key] ? ' flag-on' : ''}`} title={f.title}>
            <div className="flag-lbl">{f.label}</div>
            <div className="flag-val">{regs[f.key]}</div>
          </div>
        ))}
      </div>}
    </div>
  )
}