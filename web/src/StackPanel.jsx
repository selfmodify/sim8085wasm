import { useRef, useMemo, useState, useEffect } from 'react';
import * as sim from './simProxy.js';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtWord, BASE_CYCLE } from './utils.js';
import { useSimulator } from './SimulatorContext.jsx';
import { PopoutWindow } from './PopoutWindow.jsx';

export function StackPanel({ regs, dragHandleProps, dropTargetProps, isDragOver, theme, popoutCrtProps }) {
  const { regBase, onRegBase } = useSimulator()
  const [collapsed, toggleCollapsed] = useCollapsible('stack', false)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_stack_popped_out') === 'true')
  const panelRef = useRef(null)
  useEffect(() => {
    localStorage.setItem('sim8085_stack_popped_out', String(poppedOut))
  }, [poppedOut])
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

  const content = (
    <div className="panel-anim-body" style={poppedOut ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : undefined}>
      <div className="stack-body" style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}>
          {entries.length === 0 ? <div className="stack-empty">empty</div> : entries.map((e,i) => (<div key={e.addr} className={`stack-row${i===0?' stack-top':''}`}><span className="stack-addr">{hex4(e.addr)}</span><span className="stack-sep">→</span><span className="stack-val">{fmtWord(e.val, regBase)}</span></div>))}
        </div>
      {!poppedOut && <div className="stack-resize-handle" onMouseDown={onResizeDown} />}
    </div>
  )

  return (
    <>
      <div className={`panel stack-panel${!poppedOut && isDragOver ? ' drag-over' : ''}`} ref={!poppedOut ? panelRef : null} {...(!poppedOut ? dropTargetProps : {})}>
        {poppedOut ? (
          <>
            <div className="panel-hd" {...dragHandleProps}>
              <span><span className="panel-icon">📚</span>STACK</span>
              <div className="panel-hd-right">
                <PanelHelp panel="STACK" />
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
              <span><span className="panel-icon">📚</span>STACK</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                <code className="sp-val">SP={hex4(regs.sp)}</code>
                <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
                  title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
                <PanelHelp panel="STACK" />
              </div>
              <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
            </div>
            {!collapsed && content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Stack - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel stack-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">📚</span>STACK</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <code className="sp-val">SP={hex4(regs.sp)}</code>
                <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
                  title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
                <PanelHelp panel="STACK" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}