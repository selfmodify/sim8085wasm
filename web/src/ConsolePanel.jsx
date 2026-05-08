import { useState, useEffect, useRef } from 'react';
import { PanelHelp } from './PanelHelp.jsx';

export function ConsolePanel({ output, port, onSetPort, onClear }) {
  const bodyRef  = useRef(null)
  const [portBuf, setPortBuf] = useState(() => port.toString(16).toUpperCase().padStart(2,'0'))

  useEffect(() => { setPortBuf(port.toString(16).toUpperCase().padStart(2,'0')) }, [port])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [output])

  function commitPort() {
    const n = parseInt(portBuf.replace(/h$/i,''), 16)
    if (!isNaN(n) && n >= 0 && n <= 255) onSetPort(n & 0xFF)
  }

  const lines = output.split('\n')

  return (
    <div className="panel console-panel">
      <div className="panel-hd">
        <span className="panel-icon">🖥</span>CONSOLE
        <div className="panel-hd-right">
          <span className="console-port-label">OUT</span>
          <input className="console-port-input" value={portBuf} maxLength={2}
            onChange={e => setPortBuf(e.target.value.toUpperCase())}
            onBlur={commitPort}
            onKeyDown={e => { if (e.key === 'Enter') { commitPort(); e.target.blur() } }}
            title="Port number (hex) — bytes written here appear as ASCII text" />
          <span className="console-port-label">H</span>
          <button className="reg-base-btn" onClick={onClear} title="Clear console output">✕</button>
          <PanelHelp panel="CONSOLE" />
        </div>
      </div>
      <div className="console-body" ref={bodyRef}>
        {output === ''
          ? <span className="console-empty">No output yet — use OUT {portBuf}H to print ASCII characters</span>
          : lines.map((line, i) => (
              <div key={i} className="console-line">{line || ' '}</div>
            ))
        }
      </div>
    </div>
  )
}