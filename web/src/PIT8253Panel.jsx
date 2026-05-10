import { useRef, useEffect } from 'react';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2 } from './utils.js';

export function PIT8253Panel({ outputPorts, onClose, pos, onPosChange }) {
  const posRef = useRef(pos)

  useEffect(() => { posRef.current = pos }, [pos])

  function onDragDown(e) {
    if (e.target.closest('button')) return
    e.preventDefault()
    const doc = e.currentTarget.ownerDocument
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y
    function onMove(ev) {
      const rawX = ev.clientX - ox;
      const rawY = Math.max(0, ev.clientY - oy);
      const p = { x: Math.round(rawX / 20) * 20, y: Math.round(rawY / 20) * 20 };
      posRef.current = p; onPosChange(p)
    }
    function onUp() { doc.removeEventListener('mousemove', onMove); doc.removeEventListener('mouseup', onUp) }
    doc.addEventListener('mousemove', onMove); doc.addEventListener('mouseup', onUp)
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
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between', marginTop: '12px', marginBottom: '4px' }}>
          {[7,6,5,4,3,2,1,0].map(bit => {
            const isOn = (val >> bit) & 1;
            const ledColor = 'var(--accent, #4af0a0)';
            return (
              <div key={bit} style={{
                width: '12px', height: '12px', borderRadius: '50%',
                backgroundColor: isOn ? ledColor : 'var(--bg1)',
                boxShadow: isOn ? `0 0 8px ${ledColor}, inset 0 -2px 3px rgba(0,0,0,0.4)` : 'inset 0 2px 4px rgba(0,0,0,0.6)',
                border: `1px solid ${isOn ? 'transparent' : 'var(--border)'}`,
                transition: 'all 0.1s ease-in-out'
              }} title={`Bit ${bit} = ${isOn ? '1' : '0'}`} />
            )
          })}
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