import { useRef, useEffect } from 'react';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2 } from './utils.js';

export function PPI8255Panel({ outputPorts, inputPresets, onSetInput, onClose, pos, onPosChange }) {
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

  const basePort = 0x00;
  const ctrlPort = basePort + 3;

  const outMap = new Map(outputPorts.map(p => [p.port, p.val]))
  const inMap = new Map(inputPresets.map(p => [p.port, p.val]))

  // Default Control Word is 9BH (10011011) - Mode 0, All ports set as Input
  const ctrlVal = outMap.get(ctrlPort) ?? 0x9B;
  const isModeSet = (ctrlVal & 0x80) !== 0;
  const dirA = isModeSet && (ctrlVal & 0x10) ? 'IN' : 'OUT';
  const dirCU = isModeSet && (ctrlVal & 0x08) ? 'IN' : 'OUT';
  const dirB = isModeSet && (ctrlVal & 0x02) ? 'IN' : 'OUT';
  const dirCL = isModeSet && (ctrlVal & 0x01) ? 'IN' : 'OUT';

  function renderPort(name, port, dir) {
    const val = dir === 'OUT' ? (outMap.get(port) ?? 0) : (inMap.get(port) ?? 0);
    return (
      <div className="ppi-port">
        <div className="ppi-port-hd">
          <span>PORT {name} <span className="ppi-port-addr">({hex2(port)}H)</span></span>
          <span className={`ppi-dir ppi-dir-${dir.toLowerCase()}`}>{dir}</span>
        </div>
        <div className="ppi-bits" style={{ alignItems: 'flex-end' }}>
          {[7,6,5,4,3,2,1,0].map(bit => {
            const isOn = (val >> bit) & 1;
            const ledColor = dir === 'IN' ? 'var(--amber, #f0a840)' : 'var(--red, #ff4040)';
            return (
              <div key={bit} className={`ppi-bit${isOn ? ' on' : ''}${dir==='IN'?' clickable':''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', border: 'none', background: 'transparent' }}
                onClick={() => { if (dir === 'IN') onSetInput(port, val ^ (1 << bit)) }}>
                <div style={{
                  width: '14px', height: '14px', borderRadius: '50%',
                  backgroundColor: isOn ? ledColor : 'var(--bg1)',
                  boxShadow: isOn ? `0 0 8px ${ledColor}, inset 0 -2px 4px rgba(0,0,0,0.3)` : 'inset 0 2px 4px rgba(0,0,0,0.6)',
                  border: `1px solid ${isOn ? 'transparent' : 'var(--border)'}`,
                  transition: 'all 0.1s ease-in-out'
                }} title={`Pin ${bit} ${isOn ? 'HIGH' : 'LOW'}`} />
                {isOn ? '1' : '0'}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderPortC(port, dirU, dirL) {
    const valOut = outMap.get(port) ?? 0;
    const valIn = inMap.get(port) ?? 0;
    return (
      <div className="ppi-port">
        <div className="ppi-port-hd">
          <span>PORT C <span className="ppi-port-addr">({hex2(port)}H)</span></span>
          <span className="ppi-dir"><span className={`ppi-dir-${dirU.toLowerCase()}`}>U:{dirU}</span> <span className={`ppi-dir-${dirL.toLowerCase()}`}>L:{dirL}</span></span>
        </div>
        <div className="ppi-bits" style={{ alignItems: 'flex-end' }}>
          {[7,6,5,4,3,2,1,0].map(bit => {
            const dir = bit >= 4 ? dirU : dirL;
            const val = dir === 'OUT' ? valOut : valIn;
            const isOn = (val >> bit) & 1;
            const ledColor = dir === 'IN' ? 'var(--amber, #f0a840)' : 'var(--red, #ff4040)';
            return (
              <div key={bit} className={`ppi-bit${isOn ? ' on' : ''}${dir==='IN'?' clickable':''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', border: 'none', background: 'transparent' }}
                onClick={() => { if (dir === 'IN') onSetInput(port, valIn ^ (1 << bit)) }}>
                <div style={{
                  width: '14px', height: '14px', borderRadius: '50%',
                  backgroundColor: isOn ? ledColor : 'var(--bg1)',
                  boxShadow: isOn ? `0 0 8px ${ledColor}, inset 0 -2px 4px rgba(0,0,0,0.3)` : 'inset 0 2px 4px rgba(0,0,0,0.6)',
                  border: `1px solid ${isOn ? 'transparent' : 'var(--border)'}`,
                  transition: 'all 0.1s ease-in-out'
                }} title={`Pin C${bit} ${isOn ? 'HIGH' : 'LOW'}`} />
                {isOn ? '1' : '0'}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="ppi-float" style={{ left: pos.x, top: pos.y }}>
      <div className="ppi-float-hd" onMouseDown={onDragDown}>
        <span><span className="panel-icon">🕹️</span>8255 PPI</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <PanelHelp panel="8255 PPI" />
          <button className="ppi-float-close" onClick={onClose} title="Close">✕</button>
        </div>
      </div>
      <div className="ppi-body">
        <div className="ppi-ctrl-row">
          <span>CTRL WORD ({hex2(ctrlPort)}H):</span>
          <span className="ppi-ctrl-val">{hex2(ctrlVal)}H</span>
        </div>
        {renderPort('A', basePort + 0, dirA)}
        {renderPort('B', basePort + 1, dirB)}
        {renderPortC(basePort + 2, dirCU, dirCL)}
      </div>
    </div>
  )
}