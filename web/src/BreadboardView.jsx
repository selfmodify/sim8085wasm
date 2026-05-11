import { useState, useRef, useEffect } from 'react';
import { PPI8255Panel } from './PPI8255Panel.jsx';
import { PIT8253Panel } from './PIT8253Panel.jsx';
import { LedBreadboardPanel } from './LedBreadboardPanel.jsx';
import { useCollapsible } from './hooks.js';

const DEFAULT_WIRES = [
  { id: 'w1', start: 'pit0', end: 'ppiA_in', color: 'var(--blue, #4090ff)' },
  { id: 'w2', start: 'pit1', end: 'ppiB_in', color: 'var(--amber, #f0a840)' },
  { id: 'w3', start: 'ppiA_out', end: 'ledSeg', color: 'var(--accent, #4af0a0)' },
  { id: 'w4', start: 'ppiB_out', end: 'ledDig', color: 'var(--red, #ff4040)' },
  { id: 'w5', start: 'ppiC_out', end: 'ledStr', color: 'var(--text, #c8d4e8)' },
];

function TerminalSocket({ x, y, onMouseDown }) {
  return (
    <g style={{ pointerEvents: 'all', cursor: 'crosshair' }} onMouseDown={onMouseDown}>
      <title>Terminal Socket — drag to connect</title>
      <circle cx={x} cy={y} r="12" fill="transparent" />
      <circle cx={x} cy={y} r="6" fill="#111" stroke="#333" strokeWidth="1.5" pointerEvents="none" />
      <circle cx={x} cy={y} r="2.5" fill="#000" pointerEvents="none" />
    </g>
  );
}

function DroopingWire({ startX, startY, endX, endY, color, animate, onGrab }) {
  const dist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
  // Dynamic curve to simulate physical wire droop based on distance
  const droop = dist * 0.4 + 40; 
  const path = `M ${startX} ${startY} C ${startX} ${startY + droop}, ${endX} ${endY + droop}, ${endX} ${endY}`;
  
  return (
    <g>
      {/* Physical wire shadow */}
      <path d={path} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="6" strokeLinecap="round" style={{ transform: 'translate(2px, 6px)', filter: 'blur(3px)' }} />
      {/* Dark wire casing */}
      <path d={path} fill="none" stroke="#1a1a1a" strokeWidth="6" strokeLinecap="round" />
      {/* Colored wire core */}
      <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" style={{ filter: animate ? `drop-shadow(0 0 6px ${color})` : 'none', transition: 'filter 0.2s' }} />
      
      {/* Data flow animation */}
      {animate && (
        <path d={path} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeDasharray="4 12" strokeLinecap="round" style={{ animation: 'wire-flow 0.4s linear infinite' }} />
      )}

      {/* Top-down jumper plugs */}
      <g style={{ pointerEvents: 'all', cursor: 'grab' }} onMouseDown={(e) => onGrab && onGrab(e, 'start')}>
        <title>Grab to reroute</title>
        <circle cx={startX} cy={startY} r="12" fill="transparent" />
        <circle cx={startX} cy={startY} r="6" fill="#333" stroke="#111" strokeWidth="1.5" pointerEvents="none" />
        <circle cx={startX} cy={startY} r="2.5" fill="#555" pointerEvents="none" />
      </g>
      
      <g style={{ pointerEvents: 'all', cursor: 'grab' }} onMouseDown={(e) => onGrab && onGrab(e, 'end')}>
        <title>Grab to reroute</title>
        <circle cx={endX} cy={endY} r="12" fill="transparent" />
        <circle cx={endX} cy={endY} r="6" fill="#333" stroke="#111" strokeWidth="1.5" pointerEvents="none" />
        <circle cx={endX} cy={endY} r="2.5" fill="#555" pointerEvents="none" />
      </g>
    </g>
  );
}

export function BreadboardView({ engine, panels, togglePanel, ppiPos, setPpiPos, pitPos, setPitPos, ledPos, setLedPos, onPopOut, isPoppedOut }) {
  const [infoCollapsed, toggleInfoCollapsed] = useCollapsible('breadboard_info', false);
  const [textSize, setTextSize] = useState(0);
  const [wires, setWires] = useState(() => {
    try {
      const saved = localStorage.getItem('sim8085_wires');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return DEFAULT_WIRES;
  });
  const [dragState, setDragState] = useState(null);

  useEffect(() => { localStorage.setItem('sim8085_wires', JSON.stringify(wires)); }, [wires]);

  const hdSize = [10, 12, 14][textSize];
  const bdSize = [12, 14, 16][textSize];
  const panelWidth = [340, 400, 460][textSize];

  const terminals = {
    pit0: { x: pitPos.x + 310, y: pitPos.y + 105, color: 'var(--blue, #4090ff)', show: panels.pit },
    pit1: { x: pitPos.x + 310, y: pitPos.y + 193, color: 'var(--amber, #f0a840)', show: panels.pit },
    pit2: { x: pitPos.x + 310, y: pitPos.y + 281, color: 'var(--accent, #4af0a0)', show: panels.pit },
    ppiA_in: { x: ppiPos.x - 15, y: ppiPos.y + 100, color: 'var(--blue, #4090ff)', show: panels.ppi },
    ppiB_in: { x: ppiPos.x - 15, y: ppiPos.y + 178, color: 'var(--amber, #f0a840)', show: panels.ppi },
    ppiC_in: { x: ppiPos.x - 15, y: ppiPos.y + 256, color: 'var(--text, #c8d4e8)', show: panels.ppi },
    ppiA_out: { x: ppiPos.x + 245, y: ppiPos.y + 100, color: 'var(--accent, #4af0a0)', show: panels.ppi },
    ppiB_out: { x: ppiPos.x + 245, y: ppiPos.y + 178, color: 'var(--red, #ff4040)', show: panels.ppi },
    ppiC_out: { x: ppiPos.x + 245, y: ppiPos.y + 256, color: 'var(--text, #c8d4e8)', show: panels.ppi },
    ledSeg: { x: ledPos.x - 15, y: ledPos.y + 60, color: 'var(--accent, #4af0a0)', show: true },
    ledDig: { x: ledPos.x - 15, y: ledPos.y + 80, color: 'var(--red, #ff4040)', show: true },
    ledStr: { x: ledPos.x - 15, y: ledPos.y + 100, color: 'var(--text, #c8d4e8)', show: true },
  };

  const termsRef = useRef(terminals);
  useEffect(() => { termsRef.current = terminals; });

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e) => setDragState(d => ({ ...d, x: e.clientX, y: Math.max(0, e.clientY) }));
    const onUp = (e) => {
      let closest = null;
      let minDist = 30;
      for (const [key, t] of Object.entries(termsRef.current)) {
        if (!t.show) continue;
        const dx = e.clientX - t.x;
        const dy = e.clientY - t.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < minDist) { minDist = dist; closest = key; }
      }
      if (closest && closest !== dragState.fixedTerm) {
        setWires(ws => [...ws, {
          id: dragState.id,
          start: dragState.moving === 'start' ? closest : dragState.fixedTerm,
          end: dragState.moving === 'end' ? closest : dragState.fixedTerm,
          color: dragState.color
        }]);
      }
      setDragState(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragState]);

  const handleGrabWire = (e, wireId, endType) => {
    e.preventDefault(); e.stopPropagation();
    const w = wires.find(x => x.id === wireId);
    if (!w) return;
    const fixedTerm = endType === 'start' ? w.end : w.start;
    setDragState({ id: w.id, moving: endType, fixedTerm, x: e.clientX, y: e.clientY, color: w.color });
    setWires(ws => ws.filter(x => x.id !== wireId));
  };

  const handleNewWire = (e, termId) => {
    e.preventDefault(); e.stopPropagation();
    const t = terminals[termId];
    setDragState({ id: 'w_' + Date.now(), moving: 'end', fixedTerm: termId, x: e.clientX, y: e.clientY, color: t.color || 'var(--text2)' });
  };

  return (
    <div className="breadboard-view" style={{
      flex: 1,
      position: 'relative',
      zIndex: 0,
      backgroundColor: 'var(--bg)',
      backgroundImage: 'radial-gradient(var(--bg3) 15%, transparent 16%), radial-gradient(var(--bg3) 15%, transparent 16%)',
      backgroundSize: '20px 20px',
      backgroundPosition: '0 0, 10px 10px',
      overflow: 'hidden'
    }}>
      <div style={{ position: 'absolute', top: 20, left: 24, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--text)', margin: 0, letterSpacing: 1 }}>HARDWARE</h2>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--text2)', marginTop: 4, marginBottom: 12 }}>
          Live hardware peripherals. Drag panels to arrange them.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-xs" onClick={(e) => {
             const winWidth = e.currentTarget.ownerDocument.defaultView.innerWidth;
             setPpiPos({ x: Math.max(0, Math.round((winWidth / 2 + 50) / 20) * 20), y: 100 });
             setPitPos({ x: Math.max(0, Math.round((winWidth / 2 - 350) / 20) * 20), y: 100 });
             setLedPos({ x: Math.max(0, Math.round((winWidth / 2 - 150) / 20) * 20), y: 360 });
             setWires(DEFAULT_WIRES);
          }}>⟲ Reset Layout & Wiring</button>
          {!isPoppedOut && <button className="btn btn-xs" onClick={onPopOut} title="Open hardware view in a secondary monitor window">↗ Pop Out</button>}
        </div>
      </div>

      {/* Info Legend & Help Panel */}
      <div className="panel" style={{ position: 'absolute', top: 20, right: 24, zIndex: 100, width: panelWidth, boxShadow: 'var(--shadow-pop)', transition: 'width 0.2s ease' }}>
        <div className="panel-hd collapsible" onClick={toggleInfoCollapsed}>
          <span><span className="panel-icon">ℹ️</span>INFO &amp; CONNECTIONS</span>
          <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
            <button className={`reg-base-btn${textSize === 0 ? ' active' : ''}`} onClick={() => setTextSize(0)} title="Small Text">A</button>
            <button className={`reg-base-btn${textSize === 1 ? ' active' : ''}`} style={{ fontSize: '11px' }} onClick={() => setTextSize(1)} title="Medium Text">A</button>
            <button className={`reg-base-btn${textSize === 2 ? ' active' : ''}`} style={{ fontSize: '12px' }} onClick={() => setTextSize(2)} title="Large Text">A</button>
            <span className="panel-chevron" onClick={toggleInfoCollapsed} style={{ cursor: 'pointer', paddingLeft: '4px' }}>{infoCollapsed ? '▶' : '▼'}</span>
          </div>
        </div>
        {!infoCollapsed && (
          <div className="panel-anim-body" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '70vh', overflowY: 'auto' }}>
            <div>
              <div style={{ fontSize: hdSize, fontFamily: 'var(--mono)', color: 'var(--text3)', letterSpacing: 1, marginBottom: 8, fontWeight: 700, transition: 'font-size 0.2s ease' }}>CONNECTIONS</div>
              <div style={{ fontSize: bdSize, fontFamily: 'var(--sans)', color: 'var(--text2)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '4px', transition: 'font-size 0.2s ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue, #4090ff)' }} /> 8253 C0 → 8255 Port A</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber, #f0a840)' }} /> 8253 C1 → 8255 Port B</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent, #4af0a0)' }} /> 8255 Port A → LED Segment Data</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red, #ff4040)' }} /> 8255 Port B → LED Digit Select</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text, #c8d4e8)' }} /> 8255 Port C → LED Control Strobe</div>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
              <div style={{ fontSize: hdSize, fontFamily: 'var(--mono)', color: 'var(--text3)', letterSpacing: 1, marginBottom: 8, fontWeight: 700, transition: 'font-size 0.2s ease' }}>ABOUT WIRING</div>
              <p style={{ fontSize: bdSize, fontFamily: 'var(--sans)', color: 'var(--text2)', lineHeight: 1.5, whiteSpace: 'pre-line', margin: 0, transition: 'font-size 0.2s ease' }}>
                This is a fully interactive hardware sandbox. <strong style={{color:'var(--text)'}}>Drag from any black terminal socket to spawn a jumper cable.</strong> Grab existing cable plugs to reroute them, or drop them in empty space to remove them.
                {'\n\n'}In real physical 8085 microcomputer trainer kits, a 7-segment LED display cannot be connected directly to the CPU's data bus. Instead, it requires an interface chip like the 8255 PPI to latch the data and drive the current.
                {'\n\n'}• One port of the 8255 is wired to the LED segments (a-g, and the decimal point) to control what is displayed.
                {'\n'}• Another port is wired to the common cathodes/anodes of the digits to control which digit is currently active (known as multiplexing).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* SVG Breadboard Wiring */}
      <svg style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 505, width: '100%', height: '100%' }}>
        <style>{`
          @keyframes wire-flow {
            to { stroke-dashoffset: -16; }
          }
        `}</style>

        {Object.entries(terminals).map(([key, t]) => t.show && (
          <TerminalSocket key={key} x={t.x} y={t.y} onMouseDown={(e) => handleNewWire(e, key)} />
        ))}

        {wires.map(w => {
          const start = terminals[w.start];
          const end = terminals[w.end];
          if (!start?.show || !end?.show) return null;
          return <DroopingWire key={w.id} startX={start.x} startY={start.y} endX={end.x} endY={end.y} color={w.color} animate={engine.running} onGrab={(e, endType) => handleGrabWire(e, w.id, endType)} />;
        })}

        {dragState && (() => {
          const fixed = terminals[dragState.fixedTerm];
          if (!fixed?.show) return null;
          const sx = dragState.moving === 'start' ? dragState.x : fixed.x;
          const sy = dragState.moving === 'start' ? dragState.y : fixed.y;
          const ex = dragState.moving === 'end' ? dragState.x : fixed.x;
          const ey = dragState.moving === 'end' ? dragState.y : fixed.y;
          return <DroopingWire startX={sx} startY={sy} endX={ex} endY={ey} color={dragState.color} animate={false} />;
        })()}
      </svg>

      {panels.ppi && <PPI8255Panel outputPorts={engine.outputPorts} inputPresets={engine.inputPresets} onSetInput={engine.setInputPort} onClose={() => togglePanel('ppi')} pos={ppiPos} onPosChange={setPpiPos} />}
      {panels.pit && <PIT8253Panel outputPorts={engine.outputPorts} onClose={() => togglePanel('pit')} pos={pitPos} onPosChange={setPitPos} />}

      <LedBreadboardPanel leds={engine.leds} pos={ledPos} onPosChange={setLedPos} />

      {(!panels.ppi && !panels.pit) && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--text3)', fontFamily: 'var(--sans)', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔌</div>
          <div style={{ fontSize: '14px' }}>Hardware components are hidden.</div>
          <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>Toggle them from the Panels menu.</div>
        </div>
      )}
    </div>
  );
}