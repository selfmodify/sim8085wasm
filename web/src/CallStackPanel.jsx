import { useState, useEffect } from 'react';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4 } from './utils.js';
import { PopoutWindow } from './PopoutWindow.jsx';

export function CallStackPanel({ callStack, onJump, dragHandleProps, dropTargetProps, isDragOver, theme, popoutCrtProps }) {
  const [collapsed, toggleCollapsed] = useCollapsible('callstack', true)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_callstack_popped_out') === 'true')

  useEffect(() => {
    localStorage.setItem('sim8085_callstack_popped_out', String(poppedOut))
  }, [poppedOut])

  const content = (
    <div className="panel-anim-body" style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}>
          {callStack.length === 0
            ? <div className="callstack-empty">— empty (step to populate) —</div>
            : <div className="callstack-list" style={poppedOut ? { maxHeight: 'none' } : undefined}>
                {[...callStack].reverse().map((frame, i) => (
                  <div key={`${frame.targetAddr}-${frame.callAddr}-${i}`} className={`callstack-row${i === 0 ? ' callstack-top' : ''}`}>
                    <span className="callstack-target" title="Target address" onClick={() => onJump(frame.targetAddr)}>{hex4(frame.targetAddr)}H</span>
                    <span className="callstack-arrow">←</span>
                    <span className="callstack-site" title="Call site" onClick={() => onJump(frame.callAddr)}>{hex4(frame.callAddr)}H</span>
                    <span className="callstack-ret" title="Return address">ret:{hex4(frame.retAddr)}H</span>
                  </div>
                ))}
              </div>
          }
        </div>
  )

  return (
    <>
      <div className={`panel callstack-panel${!poppedOut && isDragOver ? ' drag-over' : ''}`} {...(!poppedOut ? dropTargetProps : {})}>
        {poppedOut ? (
          <>
            <div className="panel-hd" {...dragHandleProps}>
              <span><span className="panel-icon">📞</span>CALL STACK</span>
              <div className="panel-hd-right">
                <PanelHelp panel="CALL STACK" />
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
              <span><span className="panel-icon">📞</span>CALL STACK</span>
              {callStack.length > 0 && <span className="callstack-depth">{callStack.length}</span>}
              <div className="panel-hd-right" onClick={e => e.stopPropagation()} style={{marginLeft: 'auto'}}>
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                <PanelHelp panel="CALL STACK" />
              </div>
              <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
            </div>
            {!collapsed && content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Call Stack - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel callstack-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">📞</span>CALL STACK</span>
              {callStack.length > 0 && <span className="callstack-depth">{callStack.length}</span>}
              <div className="panel-hd-right" onClick={e => e.stopPropagation()} style={{marginLeft: 'auto'}}>
                <PanelHelp panel="CALL STACK" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}