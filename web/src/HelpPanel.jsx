import { useRef } from 'react';
import { INST_HELP } from './instHelp.js';
import { PanelHelp } from './PanelHelp.jsx';

export function HelpPanel({ instruction }) {
  const panelRef = useRef(null)
  const inst = instruction ? INST_HELP[instruction] : null

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelRef.current.getBoundingClientRect().height
    function onMove(ev) {
      panelRef.current.style.height = Math.max(60, startH + (startY - ev.clientY)) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel help-panel" ref={panelRef}>
      <div className="help-resize-handle" onMouseDown={onResizeDown} />
      <div className="panel-hd"><span className="panel-icon">📖</span>INSTRUCTION HELP<PanelHelp panel="INSTRUCTION HELP" /></div>
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
    </div>
  )
}