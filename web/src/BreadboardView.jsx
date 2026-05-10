import { useState } from 'react';
import { PPI8255Panel } from './PPI8255Panel.jsx';
import { PIT8253Panel } from './PIT8253Panel.jsx';
import { LedBreadboardPanel } from './LedBreadboardPanel.jsx';
import { useCollapsible } from './hooks.js';

function DroopingWire({ startX, startY, endX, endY, color, animate }) {
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
      <circle cx={startX} cy={startY} r="6" fill="#333" stroke="#111" strokeWidth="1.5" />
      <circle cx={startX} cy={startY} r="2.5" fill="#555" />
      
      <circle cx={endX} cy={endY} r="6" fill="#333" stroke="#111" strokeWidth="1.5" />
      <circle cx={endX} cy={endY} r="2.5" fill="#555" />
    </g>
  );
}

export function BreadboardView({ engine, panels, togglePanel, ppiPos, setPpiPos, pitPos, setPitPos, ledPos, setLedPos, onPopOut, isPoppedOut }) {
  const [infoCollapsed, toggleInfoCollapsed] = useCollapsible('breadboard_info', false);
  const [textSize, setTextSize] = useState(0);

  const hdSize = [10, 12, 14][textSize];
  const bdSize = [12, 14, 16][textSize];
  const panelWidth = [340, 400, 460][textSize];

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
          }}>⟲ Reset Layout</button>
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
              <div style={{ fontSize: hdSize, fontFamily: 'var(--mono)', color: 'var(--text3)', letterSpacing: 1, marginBottom: 8, fontWeight: 700, transition: 'font-size 0.2s ease' }}>ABOUT</div>
              <p style={{ fontSize: bdSize, fontFamily: 'var(--sans)', color: 'var(--text2)', lineHeight: 1.5, whiteSpace: 'pre-line', margin: 0, transition: 'font-size 0.2s ease' }}>
                In real physical 8085 microcomputer trainer kits, a 7-segment LED display cannot be connected directly to the CPU's data bus. Instead, it requires an interface chip to latch the data, hold the state, and drive the electrical current to light up the segments.
                {'\n\n'}The 8255 Programmable Peripheral Interface (PPI) is the standard chip used for this purpose. It provides 24 general-purpose I/O pins (grouped into Ports A, B, and C). In a typical hardware setup:
                {'\n\n'}• One port of the 8255 is wired to the LED segments (a-g, and the decimal point) to control what is displayed.
                {'\n'}• Another port is wired to the common cathodes/anodes of the digits to control which digit is currently active (known as multiplexing).
                {'\n\n'}The wires you see running from the 8255 panel to the LED display panel in the Hardware view are a visual representation of this physical hardware architecture. They illustrate that the 8255 PPI acts as the necessary bridge between the 8085 CPU and the raw LED hardware.
                {'\n\n'}Similarly, the wires connecting the 8253 PIT to the 8255 represent the timer/counter outputs being fed back into the general-purpose I/O ports, which is another common educational wiring exercise!
              </p>
            </div>
          </div>
        )}
      </div>

      {/* SVG Breadboard Wiring */}
      <svg style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 99, width: '100%', height: '100%' }}>
        <style>{`
          @keyframes wire-flow {
            to { stroke-dashoffset: -16; }
          }
        `}</style>
        {panels.pit && panels.ppi && (
          <>
            <DroopingWire startX={pitPos.x + 210} startY={pitPos.y + 80} endX={ppiPos.x + 10} endY={ppiPos.y + 110} color="var(--blue, #4090ff)" animate={engine.running} />
            <DroopingWire startX={pitPos.x + 210} startY={pitPos.y + 150} endX={ppiPos.x + 10} endY={ppiPos.y + 180} color="var(--amber, #f0a840)" animate={engine.running} />
          </>
        )}
        {panels.ppi && (
          <>
            <DroopingWire startX={ppiPos.x + 210} startY={ppiPos.y + 80} endX={ledPos.x + 10} endY={ledPos.y + 60} color="var(--accent, #4af0a0)" animate={engine.running} />
            <DroopingWire startX={ppiPos.x + 210} startY={ppiPos.y + 105} endX={ledPos.x + 10} endY={ledPos.y + 85} color="var(--red, #ff4040)" animate={engine.running} />
            <DroopingWire startX={ppiPos.x + 210} startY={ppiPos.y + 130} endX={ledPos.x + 10} endY={ledPos.y + 110} color="var(--text, #c8d4e8)" animate={engine.running} />
          </>
        )}
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