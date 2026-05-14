import { useState, useMemo } from 'react';
import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4 } from './utils.js';

export function MemMapPanel({ regs, programRegion, presetAddrs, onJump, dragHandleProps, dropTargetProps, isDragOver }) {
  const [collapsed, toggleCollapsed] = useCollapsible('memmap', false)
  const [selectedInfo, setSelectedInfo] = useState('Click a region for details')

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

  return (
    <div className={`panel memmap-panel${isDragOver ? ' drag-over' : ''}`} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span><span className="panel-icon">🗺️</span>MEMORY MAP</span>
        <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
          <PanelHelp panel="MEMORY MAP" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="panel-anim-body memmap-body">
          <div className="memmap-bar-container">
            <div className="memmap-bar">
              {programRegion && <div className="memmap-region memmap-code" style={{ top: `${(programRegion.start/65535)*100}%`, height: `${Math.max(0.5, ((programRegion.end-programRegion.start)/65535)*100)}%` }} onClick={() => { setSelectedInfo(`Code: ${hex4(programRegion.start)}H - ${hex4(programRegion.end)}H`); onJump?.(programRegion.start & 0xFFF0); }} />}
              {dataRegions.map((r, i) => <div key={r.start} className="memmap-region memmap-data" style={{ top: `${(r.start/65535)*100}%`, height: `${Math.max(0.5, ((r.end-r.start)/65535)*100)}%` }} onClick={() => { setSelectedInfo(`Data: ${hex4(r.start)}H - ${hex4(r.end)}H`); onJump?.(r.start & 0xFFF0); }} />)}
              {regs.sp > 0 && <div className="memmap-region memmap-stack" style={{ top: `${(regs.sp/65535)*100}%`, height: `${((65536-regs.sp)/65535)*100}%` }} onClick={() => { setSelectedInfo(`Stack: ${hex4(regs.sp)}H - FFFFH`); onJump?.(regs.sp & 0xFFF0); }} />}
              <div className="memmap-marker memmap-pc" style={{ top: `${(regs.pc/65535)*100}%` }} onClick={() => { setSelectedInfo(`PC: ${hex4(regs.pc)}H`); onJump?.(regs.pc & 0xFFF0); }} />
            </div>
            <div className="memmap-labels"><div style={{top: '0%'}}>0000H</div><div style={{top: '100%', transform: 'translateY(-100%)'}}>FFFFH</div></div>
          </div>
          <div className="memmap-legend">
            <div className="memmap-legend-grid"><div><span className="memmap-swatch" style={{background: 'var(--tint-blue-code)', borderColor: 'rgba(64,144,255,.5)'}}/> CODE</div><div><span className="memmap-swatch" style={{background: 'var(--tint-green-pre)', borderColor: 'rgba(74,240,160,.5)'}}/> DATA</div><div><span className="memmap-swatch" style={{background: 'var(--tint-amber-sp)', borderColor: 'var(--amber)'}}/> STACK</div><div><span className="memmap-swatch" style={{background: 'var(--tint-accent-pc)', borderColor: 'var(--accent)'}}/> PC</div></div>
            <div style={{ marginTop: 8, padding: '4px 8px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 10, color: 'var(--text2)', minHeight: 24, display: 'flex', alignItems: 'center' }}>{selectedInfo}</div>
          </div>
        </div>
      )}
    </div>
  )
}