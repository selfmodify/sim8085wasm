import { useState, useRef } from 'react';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2 } from './utils.js';

export function PIT8253Panel({ outputPorts, onClose }) {
  const [pos,  setPos]  = useState({ x: Math.max(0, window.innerWidth - 480), y: 420 })
  const posRef = useRef(pos)

  function onDragDown(e) {
    if (e.target.closest('button')) return
    e.preventDefault()
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y
    function onMove(ev) {
      const p = { x: ev.clientX - ox, y: Math.max(0, ev.clientY - oy) }
      posRef.current = p; setPos(p)
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  const outMap = new Map(outputPorts.map(p => [p.port, p.val]))
  const ctrlVal = outMap.get(0x13) ?? 0

  const sc = (ctrlVal >> 6) & 3
  const mode = (ctrlVal >> 1) & 7

  function renderCounter(idx, port) {
    const val = outMap.get(port) ?? 0
    const isActive = sc === idx
    return (
      <div className="ppi-port" style={{ borderColor: isActive ? 'var(--accent)' : 'var(--border)' }}>
        <div className="ppi-port-hd">
          <span>COUNTER {idx} <span className="ppi-port-addr">({hex2(port)}H)</span></span>
          {isActive && <span className="ppi-dir ppi-dir-out">MODE {mode}</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>VAL:</span>
          <span style={{ fontSize: 14, color: isActive ? 'var(--accent)' : 'var(--text2)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{hex2(val)}H</span>
        </div>
      </div>
    )
  }

  return (
    <div className="ppi-float" style={{ left: pos.x, top: pos.y }}>
      <div className="ppi-float-hd" onMouseDown={onDragDown}>
        <span><span className="panel-icon">⏱️</span>8253 PIT</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <PanelHelp panel="8253 PIT" />
          <button className="ppi-float-close" onClick={onClose} title="Close">✕</button>
        </div>
      </div>
      <div className="ppi-body">
        <div className="ppi-ctrl-row"><span>CTRL WORD (13H):</span><span className="ppi-ctrl-val">{hex2(ctrlVal)}H</span></div>
        {renderCounter(0, 0x10)}
        {renderCounter(1, 0x11)}
        {renderCounter(2, 0x12)}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Control Word at 13H decodes mode. Loads hit 10H-12H.</div>
      </div>
    </div>
  )
}