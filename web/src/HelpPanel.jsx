import { useRef, useState, useEffect } from 'react';
import { INST_HELP } from './instHelp.js';
import { PanelHelp } from './PanelHelp.jsx';
import { PopoutWindow } from './PopoutWindow.jsx';

export function HelpPanel({ instruction, theme, popoutCrtProps }) {
  const panelRef = useRef(null)
  const inst = instruction ? INST_HELP[instruction] : null
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_help_popped_out') === 'true')
  const [height, setHeight] = useState(() => localStorage.getItem('sim8085_help_height') || '')

  useEffect(() => {
    localStorage.setItem('sim8085_help_popped_out', String(poppedOut))
  }, [poppedOut])

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelRef.current.getBoundingClientRect().height
    function onMove(ev) {
      const newH = Math.max(60, startH + (startY - ev.clientY))
      panelRef.current.style.flex = `0 0 ${newH}px`
      panelRef.current.style.height = 'auto' // Override hardcoded CSS height
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const finalH = panelRef.current.style.flex
      setHeight(finalH)
      localStorage.setItem('sim8085_help_height', finalH)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const content = (
    <div className="help-scroll">
      {inst ? (
        <div className="help-inline-body">
          <div className="help-inline-hd">
            <span className="help-mnem help-mnem-sm">{instruction}</span>
            <span className="help-brief">{inst.brief}</span>
          </div>
          <div className="help-meta">
            <span><span className="help-lbl">Flags</span>{inst.flags}</span>
            <span><span className="help-lbl">Size</span>{inst.bytes} byte{inst.bytes !== 1 ? 's' : ''}</span>
            <span><span className="help-lbl">Cycles</span>{inst.cycles}</span>
          </div>
          <p className="help-desc">{inst.desc}</p>
          <pre className="help-ex">{inst.ex}</pre>
        </div>
      ) : (
        <div className="help-empty">Ctrl+click an instruction for details</div>
      )}
    </div>
  )

  return (
    <>
      <div className="panel help-panel" ref={panelRef} style={!poppedOut && height ? { flex: height, height: 'auto' } : undefined}>
        <div className="help-resize-handle" onMouseDown={onResizeDown} />
        <div className="panel-hd">
          <span><span className="panel-icon">📖</span>INSTRUCTION HELP</span>
          <div className="panel-hd-right">
            {!poppedOut && <button className="reg-base-btn" onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>}
            <PanelHelp panel="INSTRUCTION HELP" />
          </div>
        </div>
        {poppedOut ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text2)' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🪟</div>
            <div style={{ fontSize: 12 }}>Opened in another window.</div>
            <button className="btn btn-xs" style={{ marginTop: 12 }} onClick={() => setPoppedOut(false)}>Bring it back</button>
          </div>
        ) : content}
      </div>
      {poppedOut && (
        <PopoutWindow title="Instruction Help - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel" style={{ flex: 1, border: 'none', borderRadius: 0 }}>
            <div className="panel-hd" style={{ flexShrink: 0 }}>
              <span><span className="panel-icon">📖</span>INSTRUCTION HELP</span>
              <div className="panel-hd-right">
                <PanelHelp panel="INSTRUCTION HELP" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}