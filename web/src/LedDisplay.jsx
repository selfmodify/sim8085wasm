import { useState, useEffect } from 'react';
import { PanelHelp } from './PanelHelp.jsx';
import { PopoutWindow } from './PopoutWindow.jsx';

// ── 7-segment LED digit ──────────────────────────────────────────────────
function SevenSeg({ value }) {
  const ON = 'var(--led-on, #FF2200)', OFF = 'var(--led-off, rgba(255, 34, 0, 0.15))'
  const segs = [
    { id:'a', d:'M3 1 L11 1 L10 3 L4 3 Z', bit:1 },
    { id:'b', d:'M11 2 L13 4 L12 10 L10 8 L10 3 Z', bit:2 },
    { id:'c', d:'M12 10 L13 18 L11 20 L9 18 L10 12 Z', bit:4 },
    { id:'d', d:'M3 19 L11 19 L10 21 L4 21 Z', bit:8 },
    { id:'e', d:'M1 10 L3 8 L4 12 L3 18 L1 18 Z', bit:16 },
    { id:'f', d:'M1 2 L4 2 L4 8 L2 10 L1 8 Z', bit:32 },
    { id:'g', d:'M3 9 L5 8 L9 8 L11 9 L9 10 L5 10 Z', bit:64 },
    { id:'dot', d:'M14 19 L16 19 L16 21 L14 21 Z', bit:128 },
  ]
  return (
    <svg width="33" height="48" viewBox="0 0 17 23">
      {segs.map(s => <path key={s.id} d={s.d} fill={value & s.bit ? ON : OFF} />)}
    </svg>
  )
}

export function LedDisplay({ leds, theme, popoutCrtProps }) {
  const LABELS = ['ST1','ST0','A3','A2','A1','A0','D1','D0']
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_led_popped_out') === 'true')

  useEffect(() => {
    localStorage.setItem('sim8085_led_popped_out', String(poppedOut))
  }, [poppedOut])

  const content = (
    <div className="led-digits" style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}>
      {leds.map((v,i) => (
        <div key={LABELS[i]} className={`led-digit${i < 2 ? ' led-digit-st' : ''}`}>
          <SevenSeg value={v} />
          <div className="led-val">{v.toString(16).toUpperCase().padStart(2,'0')}</div>
          <div className="led-lbl">{LABELS[i]}</div>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <div className="panel led-panel">
        {poppedOut ? (
          <>
            <div className="panel-hd">
              <span><span className="panel-icon">💡</span>LED DISPLAY</span>
              <div className="panel-hd-right">
                <PanelHelp panel="LED DISPLAY" />
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text2)', minHeight: 90 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🪟</div>
              <div style={{ fontSize: 12 }}>Opened in another window.</div>
              <button className="btn btn-xs" style={{ marginTop: 12 }} onClick={() => setPoppedOut(false)}>Bring it back</button>
            </div>
          </>
        ) : (
          <>
            <div className="panel-hd">
              <span><span className="panel-icon">💡</span>LED DISPLAY</span>
              <div className="panel-hd-right">
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                <PanelHelp panel="LED DISPLAY" />
              </div>
            </div>
            {content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="LED Display - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel led-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">💡</span>LED DISPLAY</span>
              <div className="panel-hd-right">
                <PanelHelp panel="LED DISPLAY" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}