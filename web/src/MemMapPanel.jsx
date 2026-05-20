import { useState, useMemo, useEffect } from 'react';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4 } from './utils.js';
import { PopoutWindow } from './PopoutWindow.jsx';

export function MemMapPanel({ regs, programRegion, presetAddrs, onJump, onGotoLine, dragHandleProps, dropTargetProps, isDragOver, theme, popoutCrtProps }) {
  const [collapsed, toggleCollapsed] = useCollapsible('memmap', false)
  const [poppedOut, setPoppedOut] = useState(() => localStorage.getItem('sim8085_memmap_popped_out') === 'true')
  const [selectedInfo, setSelectedInfo] = useState('Click a region for details')
  const [dataIndex, setDataIndex] = useState(0)

  useEffect(() => {
    localStorage.setItem('sim8085_memmap_popped_out', String(poppedOut))
  }, [poppedOut])

  // Group scattered preset addresses into contiguous visual chunks
  const dataRegions = useMemo(() => {
    if (!presetAddrs || presetAddrs.size === 0) return []
    const addrs = [...presetAddrs].sort((a,b) => a-b)
    const regions = []
    let cur = { start: addrs[0], end: addrs[0] }
    for (let i = 1; i < addrs.length; i++) {
      if (addrs[i] <= cur.end + 64) cur.end = addrs[i] // cluster close elements
      else { regions.push(cur); cur = { start: addrs[i], end: addrs[i] } }
    }
    regions.push(cur)
    return regions
  }, [presetAddrs])

  const handleDataClick = () => {
    if (dataRegions.length > 0) {
      const idx = dataIndex >= dataRegions.length ? 0 : dataIndex;
      const r = dataRegions[idx];
      setSelectedInfo(dataRegions.length > 1 ? `Data [${idx + 1}/${dataRegions.length}]: ${hex4(r.start)}H - ${hex4(r.end)}H` : `Data: ${hex4(r.start)}H - ${hex4(r.end)}H`);
      onJump?.(r.start & 0xFFF0); onGotoLine?.(r.start);
      setDataIndex((idx + 1) % dataRegions.length);
    }
  }

  const content = (
        <div className="panel-anim-body memmap-body" style={poppedOut ? { flex: 1, overflowY: 'auto' } : undefined}>
          <div className="memmap-bar-container">
            <div className="memmap-bar">
              {programRegion && <div className="memmap-region memmap-code" style={{ top: `${(programRegion.start/65535)*100}%`, height: `${Math.max(0.5, ((programRegion.end-programRegion.start)/65535)*100)}%` }} onClick={() => { setSelectedInfo(`Code: ${hex4(programRegion.start)}H - ${hex4(programRegion.end)}H`); onJump?.(programRegion.start & 0xFFF0); onGotoLine?.(programRegion.start); }} />}
              {dataRegions.map((r, i) => <div key={r.start} className="memmap-region memmap-data" style={{ top: `${(r.start/65535)*100}%`, height: `${Math.max(0.5, ((r.end-r.start)/65535)*100)}%` }} onClick={() => { setSelectedInfo(`Data: ${hex4(r.start)}H - ${hex4(r.end)}H`); onJump?.(r.start & 0xFFF0); onGotoLine?.(r.start); }} />)}
              {regs.sp > 0 && <div className="memmap-region memmap-stack" style={{ top: `${(regs.sp/65535)*100}%`, height: `${((65536-regs.sp)/65535)*100}%` }} onClick={() => { setSelectedInfo(`Stack: ${hex4(regs.sp)}H - FFFFH`); onJump?.(regs.sp & 0xFFF0); onGotoLine?.(regs.sp); }} />}
              <div className="memmap-marker memmap-pc" style={{ top: `${(regs.pc/65535)*100}%` }} onClick={() => { setSelectedInfo(`PC: ${hex4(regs.pc)}H`); onJump?.(regs.pc & 0xFFF0); onGotoLine?.(regs.pc); }} />
            </div>
            <div className="memmap-labels"><div style={{top: '0%'}}>0000H</div><div style={{top: '100%', transform: 'translateY(-100%)'}}>FFFFH</div></div>
          </div>
          <div className="memmap-legend">
            <div className="memmap-legend-grid">
              <div className="memmap-legend-item" onClick={() => { if (programRegion) { setSelectedInfo(`Code: ${hex4(programRegion.start)}H - ${hex4(programRegion.end)}H`); onJump?.(programRegion.start & 0xFFF0); onGotoLine?.(programRegion.start); } }}><span className="memmap-swatch" style={{background: 'var(--tint-blue-code)', borderColor: 'rgba(64,144,255,.5)'}}/> CODE</div>
              <div className="memmap-legend-item" onClick={handleDataClick} title={dataRegions.length > 1 ? "Click to cycle through data regions" : undefined}><span className="memmap-swatch" style={{background: 'var(--tint-green-pre)', borderColor: 'rgba(74,240,160,.5)'}}/> DATA{dataRegions.length > 1 ? ' ▾' : ''}</div>
              <div className="memmap-legend-item" onClick={() => { if (regs.sp > 0) { setSelectedInfo(`Stack: ${hex4(regs.sp)}H - FFFFH`); onJump?.(regs.sp & 0xFFF0); onGotoLine?.(regs.sp); } }}><span className="memmap-swatch" style={{background: 'var(--tint-amber-sp)', borderColor: 'var(--amber)'}}/> STACK</div>
              <div className="memmap-legend-item" onClick={() => { setSelectedInfo(`PC: ${hex4(regs.pc)}H`); onJump?.(regs.pc & 0xFFF0); onGotoLine?.(regs.pc); }}><span className="memmap-swatch" style={{background: 'var(--tint-accent-pc)', borderColor: 'var(--accent)'}}/> PC</div>
            </div>
            <div style={{ marginTop: 8, padding: '4px 8px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 10, color: 'var(--text2)', minHeight: 24, display: 'flex', alignItems: 'center' }}>{selectedInfo}</div>
          </div>
        </div>
  )

  return (
    <>
      <div className={`panel memmap-panel${!poppedOut && isDragOver ? ' drag-over' : ''}`} {...(!poppedOut ? dropTargetProps : {})}>
        {poppedOut ? (
          <>
            <div className="panel-hd" {...dragHandleProps}>
              <span><span className="panel-icon">🗺️</span>MEMORY MAP</span>
              <div className="panel-hd-right">
                <PanelHelp panel="MEMORY MAP" />
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
              <span><span className="panel-icon">🗺️</span>MEMORY MAP</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <button className="reg-base-btn" style={{ marginRight: 6 }} onClick={() => setPoppedOut(true)} title="Open in separate window">⧉</button>
                <PanelHelp panel="MEMORY MAP" />
              </div>
              <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
            </div>
            {!collapsed && content}
          </>
        )}
      </div>
      {poppedOut && (
        <PopoutWindow title="Memory Map - sim8085" theme={theme} onClose={() => setPoppedOut(false)} {...popoutCrtProps}>
          <div className="panel memmap-panel" style={{ flex: 1, border: 'none', borderRadius: 0, paddingBottom: 0 }}>
            <div className="panel-hd">
              <span><span className="panel-icon">🗺️</span>MEMORY MAP</span>
              <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
                <PanelHelp panel="MEMORY MAP" />
              </div>
            </div>
            {content}
          </div>
        </PopoutWindow>
      )}
    </>
  )
}