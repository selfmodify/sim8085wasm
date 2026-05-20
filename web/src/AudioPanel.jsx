import { useState, useEffect, useRef } from 'react';
import * as sim from './simProxy.js';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2 } from './utils.js';
import { PopoutWindow } from './PopoutWindow.jsx';

export function AudioPanel({ running, onShowDialog, dragHandleProps, dropTargetProps, isDragOver, theme, popoutCrtProps }) {
  const [collapsed, toggleCollapsed] = useCollapsible('audio', false)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_audio_popped_out') === 'true')
  const [enabled, setEnabled] = useState(false)
  const [volume, setVolume] = useState(0.05)
  const [displayVal, setDisplayVal] = useState(0)
  const audioRef = useRef(null) // holds { ctx, osc, gain }
  const runningRef = useRef(running)
  const volRef = useRef(volume)

  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { volRef.current = volume }, [volume])

  useEffect(() => {
    localStorage.setItem('sim8085_audio_popped_out', String(poppedOut))
  }, [poppedOut])

  function toggleAudio() {
    if (!enabled) {
      // Initialize AudioContext directly inside the click handler to bypass browser autoplay blocks
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) { onShowDialog?.({ type: 'alert', title: 'Audio', message: 'Web Audio API not supported.' }); return }
      if (!audioRef.current) {
        const ctx = new AudioCtx()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        gain.gain.value = 0 // Start completely muted
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        audioRef.current = { ctx, osc, gain }
      }
      const { ctx } = audioRef.current
      if (ctx.state === 'suspended') ctx.resume()
      setEnabled(true)
    } else {
      // Mute and suspend
      if (audioRef.current) {
        const { ctx, gain } = audioRef.current
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015)
        setTimeout(() => { if (audioRef.current?.ctx.state === 'running') audioRef.current.ctx.suspend() }, 50)
      }
      setEnabled(false)
      setDisplayVal(0)
    }
  }

  function playTestTone() {
    if (!enabled || !audioRef.current) return onShowDialog?.({ type: 'alert', title: 'Audio', message: 'Click ON first!' })
    const { gain, osc, ctx } = audioRef.current
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    setTimeout(() => { if (audioRef.current) gain.gain.setValueAtTime(0, audioRef.current.ctx.currentTime) }, 200)
  }

  useEffect(() => {
    if (!enabled || !audioRef.current) return
    const { ctx, osc, gain } = audioRef.current

    let lastVal = -1
    let lastRun = null
    let lastVol = -1

    const timer = setInterval(() => {
      const ports = sim.simGetOutputPorts()
      const val = ports.find(p => p.port === 0x40)?.val ?? 0
      const isRun = runningRef.current
      const curVol = volRef.current
      
      setDisplayVal(prev => (prev !== val ? val : prev))

      if (val !== lastVal || isRun !== lastRun || curVol !== lastVol) {
        try {
          osc.frequency.cancelScheduledValues(ctx.currentTime)
          gain.gain.cancelScheduledValues(ctx.currentTime)
        } catch (e) {}

        if (val > 0 && isRun) {
          const freq = 100 * Math.pow(2, val / 48)
          osc.frequency.setValueAtTime(freq, ctx.currentTime)
          gain.gain.setTargetAtTime(curVol, ctx.currentTime, 0.015) // Unmute
        } else {
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015) // Mute
        }
        lastVal = val
        lastRun = isRun
        lastVol = curVol
      }
    }, 16)

    return () => clearInterval(timer)
  }, [enabled])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        try { audioRef.current.osc.stop() } catch {}
        audioRef.current.osc.disconnect()
        audioRef.current.ctx.close()
      }
    }
  }, [])

  const content = (
        <div className="panel-anim-body audio-body" style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button className={`btn btn-xs ${enabled ? 'btn-run' : ''}`} onClick={toggleAudio}>
              {enabled ? 'ON' : 'OFF'}
            </button>
            <button className="btn btn-xs" onClick={playTestTone} title="Test your browser speakers">Test Tone</button>
            <input type="range" min="0" max="0.1" step="0.01" value={volume}
              onChange={e => setVolume(+e.target.value)}
              style={{ width: '60px', accentColor: 'var(--accent)', cursor: 'pointer' }}
              title="Volume" />
            <span style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
              VAL: <span style={{ color: 'var(--accent)' }}>{hex2(displayVal)}H</span>
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            OUT 40H &gt; 0 plays tone. Set Simulator Speed to <b>Fast</b> for best playback.
          </div>
        </div>
  )

  return (
    <>
      <div className={`panel audio-panel${!poppedOut && isDragOver ? ' drag-over' : ''}`} {...(!poppedOut ? dropTargetProps : {})}>
        {poppedOut ? (
          <>
            <div className="panel-hd" {...dragHandleProps}>
              <span><span className="panel-icon">🔊</span>AUDIO (PORT 40H)</span>
              <div className="panel-hd-right">
                <PanelHelp panel="AUDIO OUTPUT" />
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text2)', minHeight: 120 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🪟</div>
              <div style={{ fontSize: 12 }}>Opened in another window.</div>
              <button className="btn btn-xs" style={{ marginTop: 12 }} onClick={() => setPoppedOut(false)}>Bring it back</button>
            </div>
          </>
        ) : (
          <>
            <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
              <span><span className="panel-icon">🔊</span>AUDIO (PORT 40H)</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                <PanelHelp panel="AUDIO OUTPUT" />
              </div>
              <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
            </div>
            {!collapsed && content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Audio - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel audio-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">🔊</span>AUDIO (PORT 40H)</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <PanelHelp panel="AUDIO OUTPUT" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}