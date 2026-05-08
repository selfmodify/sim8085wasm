import { useState } from 'react';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2 } from './utils.js';

export function IOPortPanel({ outputPorts, inputPresets, onSetInput, onRemoveInput, keyQueue, onEnqueueKeys, onClearKeyQueue, sid, sod, onSetSID, dragHandleProps, dropTargetProps, isDragOver }) {
  const [collapsed, toggleCollapsed] = useCollapsible('ioports', true)
  const [portBuf, setPortBuf] = useState('')
  const [valBuf,  setValBuf]  = useState('')
  const [kbdBuf,  setKbdBuf]  = useState('')

  function addPreset() {
    const port = parseInt(portBuf.replace(/h$/i,''), 16)
    const val  = parseInt(valBuf.replace(/h$/i,''), 16)
    if (isNaN(port) || port < 0 || port > 255) return
    onSetInput(port & 0xFF, isNaN(val) ? 0 : val & 0xFF)
    setPortBuf(''); setValBuf('')
  }

  function submitKbd() {
    if (!kbdBuf) return
    onEnqueueKeys(kbdBuf)
    setKbdBuf('')
  }

  return (
    <div className={`panel ioport-panel${isDragOver ? ' drag-over' : ''}`} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span className="panel-icon">🔌</span>I/O PORTS
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="I/O PORTS" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && <>
      <div className="ioport-section-hd">OUTPUT  <span className="ioport-hint">written by OUT</span></div>
      {outputPorts.length === 0
        ? <div className="ioport-empty">No OUT executed yet</div>
        : outputPorts.map(({ port, val }) => (
          <div key={port} className="ioport-row">
            <span className="ioport-port">{hex2(port)}H</span>
            <span className="ioport-arrow">→</span>
            <span className="ioport-val">{hex2(val)}H</span>
            <span className="ioport-dec">{val}</span>
          </div>
        ))
      }

      <div className="ioport-section-hd" style={{marginTop:'6px'}}>INPUT  <span className="ioport-hint">returned by IN</span></div>
      <div className="ioport-add-row">
        <input className="ioport-input" placeholder="port (hex)" value={portBuf}
          onChange={e => setPortBuf(e.target.value.toUpperCase())}
          onKeyDown={e => e.key==='Enter' && addPreset()} maxLength={3} />
        <input className="ioport-input" placeholder="value" value={valBuf}
          onChange={e => setValBuf(e.target.value.toUpperCase())}
          onKeyDown={e => e.key==='Enter' && addPreset()} maxLength={3} />
        <button className="btn btn-xs" onClick={addPreset}>+</button>
      </div>
      {inputPresets.length === 0
        ? <div className="ioport-empty">No input ports set</div>
        : inputPresets.map(({ port, val }) => (
          <div key={port} className="ioport-row">
            <span className="ioport-port">{hex2(port)}H</span>
            <span className="ioport-arrow">←</span>
            <span className="ioport-val">{hex2(val)}H</span>
            <span className="ioport-dec">{val}</span>
            <button className="watch-rm" onClick={() => onRemoveInput(port)}>✕</button>
          </div>
        ))
      }

      <div className="ioport-section-hd" style={{marginTop:'6px'}}>SERIAL  <span className="ioport-hint">SID/SOD pins</span></div>
      <div className="ioport-serial-row">
        <span className="ioport-serial-lbl">SID (in):</span>
        <button className={`btn btn-xs ioport-serial-btn${sid ? ' active' : ''}`}
          onClick={() => onSetSID(sid ? 0 : 1)} title="Toggle Serial Input Data line">{sid ? '1' : '0'}</button>
        <span className="ioport-serial-lbl" style={{marginLeft:'10px'}}>SOD (out):</span>
        <span className={`ioport-serial-val${sod ? ' active' : ''}`} title="Serial Output Data line">{sod ? '1' : '0'}</span>
      </div>

      <div className="ioport-section-hd" style={{marginTop:'6px'}}>KEYBOARD  <span className="ioport-hint">C=01H syscall input</span></div>
      <div className="ioport-add-row">
        <input className="ioport-kbd-input" placeholder="type to enqueue…"
          value={kbdBuf} onChange={e => setKbdBuf(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submitKbd()} />
        <button className="btn btn-xs" onClick={submitKbd}>+</button>
      </div>
      {keyQueue.length === 0
        ? <div className="ioport-empty">Queue empty</div>
        : <div className="ioport-kbd-chips">
            {keyQueue.map((ch, i) => (
              <span key={`${ch}-${i}`} className="ioport-kbd-chip"
                title={`0x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0')}`}>
                {ch === ' ' ? '·' : ch}
              </span>
            ))}
            <button className="watch-rm" onClick={onClearKeyQueue} title="Clear queue">✕</button>
          </div>
      }
      </>}
    </div>
  )
}