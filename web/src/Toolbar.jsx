import { ExampleMenu } from './ExampleMenu.jsx';
import { PanelsMenu } from './PanelsMenu.jsx';
import { SPEEDS } from './utils.js';

export function Speedometer({ mhz, running, size = 'lg', className, style }) {
  const m = mhz || 0;
  const pct = m <= 0 ? 0 : Math.max(0, Math.min(1, (Math.log10(m) + 4) / 5));
  const activePct = running ? pct : 0;
  const color = pct > 0.9 ? 'var(--red)' : pct > 0.7 ? 'var(--amber)' : 'var(--accent)';
  const textOpacity = running ? 1 : 0.5;

  if (size === 'sm') {
    const text = m >= 1000 ? `${(m/1000).toFixed(1)} GHz` : m >= 1 ? `${m.toFixed(1)} MHz` : `${(m*1000).toFixed(0)} kHz`;
    const dash = 42.41;
    const full = 56.55;
    return (
      <div className={`toolbar-speedometer ${className || ''}`} title="Simulated throughput" style={style}>
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ overflow: 'visible', flexShrink: 0 }}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${dash} ${full}`} transform="rotate(135 12 12)" />
          {Array.from({ length: 3 }).map((_, i) => (
            <line key={i} x1="19.5" y1="12" x2="16.5" y2="12" stroke="var(--text2)" strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${135 + (i / 2) * 270} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${dash} ${full}`} strokeDashoffset={dash * (1 - activePct)} transform="rotate(135 12 12)" style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s', filter: running ? 'drop-shadow(0 0 4px currentColor)' : 'none', opacity: running ? 1 : 0.55 }} />
          <g style={{ transform: `rotate(${135 + activePct * 270}deg)`, transformOrigin: '12px 12px', transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}>
            <g className={running ? 'needle-vibrating' : ''} style={{ transformOrigin: '12px 12px' }}>
              <line x1="12" y1="12" x2="19" y2="12" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))' }} />
            </g>
          </g>
          <circle cx="12" cy="12" r="2" fill="var(--text)" />
        </svg>
        <span style={{ minWidth: '68px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 14, color: color, opacity: textOpacity, fontWeight: 600, transition: 'opacity 0.6s' }}>{text}</span>
      </div>
    )
  }

  const text = m >= 1000 ? `${(m/1000).toFixed(1)}G` : m >= 1 ? `${m.toFixed(1)}M` : `${(m*1000).toFixed(0)}k`;
  const dash = 188.50; // 270 degree arc length (r=40)
  const full = 251.33; // Full circle length
  return (
    <div className={`speedometer-main ${className || ''}`} title="Simulated throughput" style={style}>
      <svg width="96" height="96" viewBox="0 0 96 96" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', overflow: 'visible' }}>
        <circle cx="48" cy="48" r="40" fill="transparent" stroke="var(--border)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${dash} ${full}`} transform="rotate(135 48 48)" />
        {Array.from({ length: 9 }).map((_, i) => {
          const isMajor = i % 2 === 0;
          return <line key={i} x1="85" y1="48" x2={isMajor ? "75" : "79"} y2="48" stroke="var(--text2)" strokeWidth={isMajor ? "2" : "1.5"} strokeLinecap="round" transform={`rotate(${135 + (i / 8) * 270} 48 48)`} />
        })}
        <circle cx="48" cy="48" r="40" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${dash} ${full}`} strokeDashoffset={dash * (1 - activePct)} transform="rotate(135 48 48)" style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s', filter: running ? 'drop-shadow(0 0 8px currentColor)' : 'none', opacity: running ? 1 : 0.55 }} />
        <g style={{ transform: `rotate(${135 + activePct * 270}deg)`, transformOrigin: '48px 48px', transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <g className={running ? 'needle-vibrating' : ''} style={{ transformOrigin: '48px 48px' }}>
            <line x1="48" y1="48" x2="80" y2="48" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.5))' }} />
          </g>
        </g>
        <circle cx="48" cy="48" r="5" fill="var(--text)" stroke="var(--border2)" strokeWidth="2" />
      </svg>
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, 8px)', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 20, color: color, opacity: textOpacity, fontWeight: 700, letterSpacing: '-0.5px', textShadow: running ? '0 0 10px currentColor' : 'none', lineHeight: 1, transition: 'opacity 0.6s' }}>{text}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: color, opacity: running ? 0.6 : 0.3, fontWeight: 700, letterSpacing: '1px', marginTop: 2, transition: 'opacity 0.6s' }}>Hz</span>
      </div>
    </div>
  )
}

export function Toolbar({
  onLoadExample, panels, onTogglePanel, fileInputRef, onImportFile,
  isDirty, onBuild, running, appState, mhz, onStep, onStepOver, onStepOut,
  onStepBack, histLen, onRun, runSpeed, onSpeedChange, onReset
}) {
  return (
    <div className="toolbar">
      <ExampleMenu onLoad={onLoadExample} />
      <PanelsMenu panels={panels} onToggle={onTogglePanel} />
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".asm,.85,.s,.txt,.hex,.bin" onChange={onImportFile} />
      <button className={`btn btn-asm${isDirty ? ' btn-asm-dirty' : ''}`} onClick={onBuild} title={isDirty ? "Unsaved changes — click to rebuild" : "Code is up to date"}>
        ⚙ Build{isDirty ? ' •' : ''}  <kbd>F5</kbd>
      </button>
      <button className="btn btn-step" onClick={onStep} disabled={running || appState === 'error'}>↓ Step    <kbd>F7</kbd></button>
      <button className="btn btn-step-over" onClick={onStepOver} disabled={running || appState === 'error'}>↷ Over    <kbd>F8</kbd></button>
      <button className="btn btn-step-out" onClick={onStepOut} disabled={running || appState === 'error'}>↵ Out     <kbd>F10</kbd></button>
      <button className="btn btn-back" onClick={onStepBack} disabled={running || appState === 'error' || histLen === 0} title={`Undo last step (${histLen} available)`}>⟲ Back{histLen > 0 ? ` (${histLen})` : ''}</button>
      <button className={`btn ${running ? 'btn-stop' : 'btn-run'}`} onClick={onRun} disabled={!running && appState === 'error'}>
        {running ? '■ Stop' : '▶ Run'}  <kbd>F9</kbd>
      </button>
      <label className="speed-label" title={SPEEDS[runSpeed].warp ? 'Warp: run until HLT, updating UI once per second' : SPEEDS[runSpeed].delay ? `Auto: ${SPEEDS[runSpeed].steps} step every ${SPEEDS[runSpeed].delay}ms` : `${SPEEDS[runSpeed].steps.toLocaleString()} steps/tick`}>
        Speed
        <input type="range" min={0} max={SPEEDS.length - 1} value={runSpeed} className="speed-slider"
          onChange={onSpeedChange} />
        <span className="speed-val">{SPEEDS[runSpeed].label}</span>
      </label>
      <button className="btn btn-reset" onClick={onReset} disabled={running}>↺ Reset  <kbd>F6</kbd></button>
      
      <div className="mobile-only" style={{ borderLeft: '1px solid var(--border)', paddingLeft: '8px', marginLeft: 'auto' }}>
        <Speedometer mhz={mhz} running={running} size="sm" />
      </div>
    </div>
  );
}