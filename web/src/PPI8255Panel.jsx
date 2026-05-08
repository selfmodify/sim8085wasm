import { useState, useRef } from 'react';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2 } from './utils.js';

export function PPI8255Panel({ outputPorts, inputPresets, onSetInput, onClose }) {
  const [pos,  setPos]  = useState({ x: Math.max(0, window.innerWidth - 260), y: 420 })
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
        <div className="ppi-bits">
          {[7,6,5,4,3,2,1,0].map(bit => {
            const isOn = (val >> bit) & 1;
            return (
              <div key={bit} className={`ppi-bit${isOn ? ' on' : ''}${dir==='IN'?' clickable':''}`}
                onClick={() => { if (dir === 'IN') onSetInput(port, val ^ (1 << bit)) }}>
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
        <div className="ppi-bits">
          {[7,6,5,4,3,2,1,0].map(bit => {
            const dir = bit >= 4 ? dirU : dirL;
            const val = dir === 'OUT' ? valOut : valIn;
            const isOn = (val >> bit) & 1;
            return (
              <div key={bit} className={`ppi-bit${isOn ? ' on' : ''}${dir==='IN'?' clickable':''}`}
                onClick={() => { if (dir === 'IN') onSetInput(port, valIn ^ (1 << bit)) }}>
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