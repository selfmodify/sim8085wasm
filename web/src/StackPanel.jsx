import { useRef, useMemo } from 'react';
import * as sim from './simProxy.js';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtWord, BASE_CYCLE } from './utils.js';
import { useSimulator } from './SimulatorContext.jsx';

export function StackPanel({ regs, dragHandleProps, dropTargetProps, isDragOver }) {
  const { regBase, onRegBase } = useSimulator()
  const [collapsed, toggleCollapsed] = useCollapsible('stack', false)
  const panelRef = useRef(null)
  const entries = useMemo(() => {
    const out = []
    for (let i = 0; i < 64; i++) {
      const a = (regs.sp + i*2) & 0xFFFF
      out.push({ addr: a, val: sim.simReadByte(a) | (sim.simReadByte(a+1)<<8) })
    }
    return out
  }, [regs.sp])

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY, startH = panelRef.current.getBoundingClientRect().height
    const onMove = ev => {
      const colBottom = panelRef.current.parentElement.getBoundingClientRect().bottom
      const panelTop = panelRef.current.getBoundingClientRect().top
      const maxH = Math.max(72, colBottom - panelTop - 32)
      panelRef.current.style.height = Math.max(72, Math.min(maxH, startH + (ev.clientY - startY))) + 'px'
    }
    const onUp   = ()  => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className={`panel stack-panel${isDragOver ? ' drag-over' : ''}`} ref={panelRef} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span className="panel-icon">📚</span>STACK
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <code className="sp-val">SP={hex4(regs.sp)}</code>
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="STACK" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <div className="panel-anim-body">
        <div className="stack-body">
          {entries.length === 0 ? <div className="stack-empty">empty</div> : entries.map((e,i) => (<div key={e.addr} className={`stack-row${i===0?' stack-top':''}`}><span className="stack-addr">{hex4(e.addr)}</span><span className="stack-sep">→</span><span className="stack-val">{fmtWord(e.val, regBase)}</span></div>))}
        </div>
        <div className="stack-resize-handle" onMouseDown={onResizeDown} />
      </div>}
    </div>
  )
}