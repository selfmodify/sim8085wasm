import { useState, useEffect, useRef } from 'react';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtTraceVal, TRACE_REG16 } from './utils.js';
import { PopoutWindow } from './PopoutWindow.jsx';

export function TracePanel({ trace, onClear, dragHandleProps, dropTargetProps, isDragOver, theme, popoutCrtProps }) {
  const [collapsed, toggleCollapsed] = useCollapsible('trace', true)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_trace_popped_out') === 'true')
  const bodyRef = useRef(null)
  
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [trace])

  useEffect(() => {
    localStorage.setItem('sim8085_trace_popped_out', String(poppedOut))
  }, [poppedOut])

  const content = (
      <div className="panel-anim-body trace-body" ref={bodyRef}>
        {trace.length === 0
          ? <div className="trace-empty">Step through code to record execution</div>
          : trace.map((e, i) => (
            <div key={`${e.addr}-${i}`} className="trace-row">
              <span className="trace-addr">{hex4(e.addr)}</span>
              <span className="trace-text">{e.text.replace(/^[0-9A-Fa-f]{4}\s+(?:[0-9A-Fa-f]{2}\s+)+/, '').trim()}</span>
              {e.changedKeys.length > 0 &&
                <span className="trace-delta">
                  {e.changedKeys.map(k => {
                    const FLAG_SHORT = { flagS:'S', flagZ:'Z', flagAC:'AC', flagP:'P', flagCY:'CY' }
                    const isFlag = !!FLAG_SHORT[k]
                    const is16 = TRACE_REG16.has(k)
                    const name = FLAG_SHORT[k] ?? k.toUpperCase()
                    const val  = isFlag ? e.regs[k] : fmtTraceVal(k, e.regs[k])
                    const color = isFlag ? '#ff8a66' : is16 ? '#c792ea' : '#82aaff'
                    return <span key={k} style={{ color, marginRight: 7 }}>{name}={val}</span>
                  })}
                </span>
              }
            </div>
          ))
        }
      </div>
  )

  return (
    <>
      <div className={`panel trace-panel${!poppedOut && isDragOver ? ' drag-over' : ''}`} {...(!poppedOut ? dropTargetProps : {})}>
        {poppedOut ? (
          <>
            <div className="panel-hd" {...dragHandleProps}>
              <span><span className="panel-icon">📜</span>TRACE</span>
              <div className="panel-hd-right">
                <PanelHelp panel="TRACE" />
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
              <span><span className="panel-icon">📜</span>TRACE</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                <button className="reg-base-btn" onClick={onClear} title="Clear trace">✕</button>
                <PanelHelp panel="TRACE" />
              </div>
              <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
            </div>
            {!collapsed && content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Trace - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel trace-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">📜</span>TRACE</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <button className="reg-base-btn" onClick={onClear} title="Clear trace">✕</button>
                <PanelHelp panel="TRACE" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}