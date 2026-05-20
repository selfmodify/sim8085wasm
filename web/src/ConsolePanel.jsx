import { useState, useEffect, useRef } from 'react';
import { PanelHelp } from './PanelHelp.jsx';
import { PopoutWindow } from './PopoutWindow.jsx';

export function ConsolePanel({ output, port, onSetPort, onClear, theme, popoutCrtProps }) {
  const bodyRef  = useRef(null)
  const panelRef = useRef(null)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_console_popped_out') === 'true')
  const [portBuf, setPortBuf] = useState(() => port.toString(16).toUpperCase().padStart(2,'0'))
  const [height, setHeight] = useState(() => localStorage.getItem('sim8085_console_height') || '')

  useEffect(() => { setPortBuf(port.toString(16).toUpperCase().padStart(2,'0')) }, [port])

  useEffect(() => {
    localStorage.setItem('sim8085_console_popped_out', String(poppedOut))
  }, [poppedOut])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [output])

  function commitPort() {
    const n = parseInt(portBuf.replace(/h$/i,''), 16)
    if (!isNaN(n) && n >= 0 && n <= 255) onSetPort(n & 0xFF)
  }

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelRef.current.getBoundingClientRect().height
    function onMove(ev) {
      const newH = Math.max(60, startH + (startY - ev.clientY))
      panelRef.current.style.flex = `0 0 ${newH}px`
      panelRef.current.style.maxHeight = 'none' // Override CSS max-height constraint
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const finalH = panelRef.current.style.flex
      setHeight(finalH)
      localStorage.setItem('sim8085_console_height', finalH)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const lines = output.split('\n')

  const content = (
      <div className="console-body" ref={bodyRef} style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}>
        {output === ''
          ? <span className="console-empty">No output yet — use OUT {portBuf}H to print ASCII characters</span>
          : lines.map((line, i) => (
              <div key={i} className="console-line">{line || ' '}</div>
            ))
        }
      </div>
  )

  return (
    <>
      <div className="panel console-panel" ref={!poppedOut ? panelRef : null} style={!poppedOut && height ? { flex: height, maxHeight: 'none' } : undefined}>
        {poppedOut ? (
          <>
            <div className="panel-hd">
              <span><span className="panel-icon">🖥</span>CONSOLE</span>
              <div className="panel-hd-right">
                <PanelHelp panel="CONSOLE" />
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text2)' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🪟</div>
              <div style={{ fontSize: 12 }}>Opened in another window.</div>
              <button className="btn btn-xs" style={{ marginTop: 12 }} onClick={() => setPoppedOut(false)}>Bring it back</button>
            </div>
          </>
        ) : (
          <>
            <div className="console-resize-handle" onMouseDown={onResizeDown} />
            <div className="panel-hd">
              <span><span className="panel-icon">🖥</span>CONSOLE</span>
              <div className="panel-hd-right">
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
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
            {content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Console - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel console-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0, maxHeight: 'none' }}>
            <div className="panel-hd">
              <span><span className="panel-icon">🖥</span>CONSOLE</span>
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
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}