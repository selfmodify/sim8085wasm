import { useEffect, useRef } from 'react';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtTraceVal, TRACE_REG16 } from './utils.js';

export function TracePanel({ trace, onClear, dragHandleProps, dropTargetProps, isDragOver }) {
  const [collapsed, toggleCollapsed] = useCollapsible('trace', true)
  const bodyRef = useRef(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [trace])

  return (
    <div className={`panel trace-panel${isDragOver ? ' drag-over' : ''}`} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span className="panel-icon">📜</span>TRACE
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <button className="reg-base-btn" onClick={onClear} title="Clear trace">✕</button>
          <PanelHelp panel="TRACE" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <div className="trace-body" ref={bodyRef}>
        {trace.length === 0
          ? <div className="trace-empty">Step or run to record execution</div>
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
      </div>}
    </div>
  )
}