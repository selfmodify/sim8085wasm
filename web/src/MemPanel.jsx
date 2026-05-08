import { useState, useEffect, useRef, useMemo } from 'react';
import * as sim from './simProxy.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex2, hex4 } from './utils.js';

export function MemPanel({ memStart, onJump, regs, buildId, changedAddrs, programRegion, presetAddrs, onMemoryEdited, onShowDialog }) {
  const [mem, setMem] = useState(new Uint8Array(128))
  const [followPC, setFollowPC] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editBuf, setEditBuf] = useState('')
  const [rows, setRows] = useState(8)
  const [addrBuf, setAddrBuf] = useState(hex4(memStart))
  const [cursor, setCursor] = useState(memStart)
  const [showSearch, setShowSearch] = useState(false)
  const [showFill, setShowFill]     = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [searchVal, setSearchVal]   = useState('')
  const [searchMatches, setSearchMatches] = useState([])
  const [searchIdx, setSearchIdx]   = useState(0)
  const [fillFrom, setFillFrom]     = useState('')
  const [fillTo, setFillTo]         = useState('')
  const [fillVal, setFillVal]       = useState('')
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo]     = useState('')
  const [searchRan, setSearchRan]   = useState(false)
  const addrFocused = useRef(false)
  const COLS = 16
  const scrollRef = useRef(null)
  const panelRef  = useRef(null)

  const searchMatchSet  = useMemo(() => new Set(searchMatches), [searchMatches])
  const previewSet = useMemo(() => {
    let fromStr, toStr
    if (showFill) { fromStr = fillFrom; toStr = fillTo }
    else if (showExport) { fromStr = exportFrom; toStr = exportTo }
    else return new Set()
    const from = parseInt(fromStr, 16), to = parseInt(toStr, 16)
    if (isNaN(from) || isNaN(to)) return new Set()
    const start = Math.min(from, to) & 0xFFFF
    const end   = Math.min(Math.max(from, to) & 0xFFFF, 0xFFFF)
    const s = new Set()
    for (let a = start; a <= end; a++) s.add(a)
    return s
  }, [showFill, fillFrom, fillTo, showExport, exportFrom, exportTo])

  useEffect(() => { if (!addrFocused.current) setAddrBuf(hex4(memStart)) }, [memStart])

  function manualJump(addr) {
    setFollowPC(false)
    onJump(addr)
  }

  useEffect(() => {
    if (!followPC) return
    const visEnd = memStart + COLS * rows - 1
    if (regs.pc < memStart || regs.pc > visEnd) {
      onJump((regs.pc >> 4) << 4)
    }
  }, [regs.pc, followPC, memStart, rows, onJump])

  // When viewport jumps externally (address input, ◀/▶), clamp cursor into view
  useEffect(() => {
    setCursor(c => {
      const visEnd = memStart + COLS * rows - 1
      return (c < memStart || c > visEnd) ? memStart : c
    })
  }, [memStart, rows])

  useEffect(() => {
    if (!scrollRef.current) return
    const ro = new ResizeObserver(([e]) => {
      setRows(r => { const n = Math.max(2, Math.floor((e.contentRect.height - 22) / 20)); return n !== r ? n : r })
    })
    ro.observe(scrollRef.current)
    return () => ro.disconnect()
  }, [])

  function onHandleMouseDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const targetEl = panelRef.current.closest('.mem-watch-row') || panelRef.current
    const startH = targetEl.getBoundingClientRect().height
    function onMove(ev) {
      targetEl.style.height = Math.max(80, startH + (startY - ev.clientY)) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function refresh() { setMem(sim.simGetMemory(memStart, COLS * rows)) }
  useEffect(refresh, [memStart, regs.pc, rows, buildId])

  function commit(addr, raw) {
    const v = parseInt(raw, 16)
    if (!isNaN(v)) {
      sim.simWriteByte(addr, v)
      onMemoryEdited?.()
    }
    setEditing(null)
    refresh()
  }

  function moveCursor(delta) {
    const next = Math.max(0, Math.min(0xFFFF, cursor + delta))
    setCursor(next)
    const visEnd = memStart + COLS * rows - 1
    if (next < memStart) {
      manualJump((next >> 4) << 4)
    } else if (next > visEnd) {
      manualJump(Math.max(0, ((next >> 4) << 4) - COLS * (rows - 1)))
    }
  }

  function onPanelKey(e) {
    if (addrFocused.current || editing !== null) return
    const pageSize = COLS * rows
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveCursor(-COLS) }
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveCursor(+COLS) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); moveCursor(-1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor(+1) }
    if (e.key === 'PageUp')     { e.preventDefault(); moveCursor(-pageSize) }
    if (e.key === 'PageDown')   { e.preventDefault(); moveCursor(+pageSize) }
  }

  function runSearch() {
    const v = parseInt(searchVal, 16)
    if (isNaN(v)) return
    const allMem = sim.simGetMemory(0, 0x10000)
    const matches = []
    for (let i = 0; i < allMem.length; i++) {
      if (allMem[i] === (v & 0xFF)) matches.push(i)
    }
    setSearchMatches(matches)
    setSearchIdx(0)
    setSearchRan(true)
    if (matches.length > 0) manualJump(matches[0] & 0xFFF0)
  }

  function searchNav(dir) {
    if (searchMatches.length === 0) return
    const idx = (searchIdx + dir + searchMatches.length) % searchMatches.length
    setSearchIdx(idx)
    manualJump(searchMatches[idx] & 0xFFF0)
  }

  function runFill() {
    const from = parseInt(fillFrom, 16)
    const to   = parseInt(fillTo, 16)
    const val  = parseInt(fillVal, 16)
    if (isNaN(from) || isNaN(to) || isNaN(val)) return
    const start = Math.min(from, to) & 0xFFFF
    const end   = Math.min(Math.max(from, to) & 0xFFFF, 0xFFFF)
    for (let a = start; a <= end; a++) sim.simWriteByte(a, val & 0xFF)
    refresh()
    onMemoryEdited?.()
  }

  function runExport() {
    const from = parseInt(exportFrom, 16)
    const to   = parseInt(exportTo, 16)
    if (isNaN(from) || isNaN(to)) return
    const start = Math.min(from, to) & 0xFFFF
    const end   = Math.min(Math.max(from, to) & 0xFFFF, 0xFFFF)
    const len = end - start + 1
    const buf = sim.simGetMemory(start, len)
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `memory_${hex4(start)}-${hex4(end)}.bin`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  function clearMemory() {
    onShowDialog?.({
      type: 'confirm',
      title: 'Clear Memory',
      message: 'Clear all memory? This will overwrite everything with 00H.',
      confirmText: 'Clear',
      onConfirm: () => {
        for (let i = 0; i <= 0xFFFF; i++) sim.simWriteByte(i, 0)
        refresh()
        onMemoryEdited?.()
      }
    })
  }

  return (
    <div className="panel mem-panel" ref={panelRef} tabIndex={0} onKeyDown={onPanelKey}>
      <div className="mem-resize-handle" onMouseDown={onHandleMouseDown} />
      <div className="panel-hd">
        <span className="panel-icon">💾</span>MEMORY
        <div className="panel-hd-right">
        <span className="mem-ctrl">
          <button className={`mem-btn${followPC ? ' mem-btn-active' : ''}`} style={{ width: 42 }}
            title={followPC ? 'Following PC — click to unlock' : 'Not following PC — click to lock'}
            onClick={() => setFollowPC(f => !f)}>
            {followPC ? 'PC↓' : 'PC·'}
          </button>
          <button className="mem-btn" title="Back 4 pages" onClick={() => manualJump(Math.max(0, memStart - COLS*rows*4))}>«</button>
          <button className="mem-btn" onClick={() => manualJump(Math.max(0, memStart - COLS*rows))}>◀</button>
          <input
            className="mem-cur-addr"
            value={addrBuf}
            maxLength={4}
            spellCheck={false}
            onChange={e => setAddrBuf(e.target.value.toUpperCase())}
            onFocus={e => { addrFocused.current = true; e.target.select() }}
            onBlur={() => { addrFocused.current = false; setAddrBuf(hex4(memStart)) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { const v = parseInt(addrBuf, 16); if (!isNaN(v)) manualJump(v & 0xFFF0); e.target.blur() }
              if (e.key === 'Escape') { setAddrBuf(hex4(memStart)); e.target.blur() }
            }}
          />
        <button className="mem-btn" onClick={() => manualJump(Math.min(0xFFF0, memStart + COLS*rows))}>▶</button>
        <button className="mem-btn" title="Forward 4 pages" onClick={() => manualJump(Math.min(0xFFF0, memStart + COLS*rows*4))}>»</button>
        </span>
        <span style={{width:8, flexShrink:0}} />
        <button className={`mem-btn${showSearch ? ' mem-btn-active' : ''}`}
          title="Find byte in memory (toggle)"
          onClick={() => { setShowSearch(s => !s); setShowFill(false); setShowExport(false) }}>🔍</button>
        <button className={`mem-btn${showFill ? ' mem-btn-active' : ''}`}
          title="Fill memory range (toggle)"
          onClick={() => { setShowFill(s => !s); setShowSearch(false); setShowExport(false) }}>⊞</button>
        <button className={`mem-btn${showExport ? ' mem-btn-active' : ''}`}
          title="Export memory range (toggle)"
          onClick={() => { setShowExport(s => !s); setShowSearch(false); setShowFill(false) }}>⬇</button>
      <button className="mem-btn" title="Clear all memory" onClick={clearMemory}>🗑</button>
        <PanelHelp panel="MEMORY" wide />
        </div>
      </div>
      {showSearch && (
        <div className="mem-toolbar mem-toolbar-search">
          <span className="mem-toolbar-lbl">FIND</span>
          <input className="mem-toolbar-input" placeholder="FF" maxLength={2} style={{width:36}}
            autoFocus
            value={searchVal}
            onChange={e => { setSearchVal(e.target.value.toUpperCase()); setSearchRan(false) }}
            onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
          />
          <button className="mem-btn" onClick={runSearch}>Search</button>
          {searchMatches.length > 0 && <>
            <button className="mem-btn" onClick={() => searchNav(-1)}>◀</button>
            <button className="mem-btn" onClick={() => searchNav(+1)}>▶</button>
            <span className="mem-toolbar-count">{searchIdx+1}/{searchMatches.length}</span>
          </>}
          {searchRan && searchMatches.length === 0 && <span className="mem-toolbar-count">no match</span>}
        </div>
      )}
      {showFill && (
        <div className="mem-toolbar mem-toolbar-fill">
          <span className="mem-toolbar-lbl">FILL</span>
          <input className="mem-toolbar-input" placeholder="0000" maxLength={4} style={{width:46}}
            autoFocus
            value={fillFrom} onChange={e => setFillFrom(e.target.value.toUpperCase())} title="Start address" />
          <span className="mem-toolbar-lbl">–</span>
          <input className="mem-toolbar-input" placeholder="00FF" maxLength={4} style={{width:46}}
            value={fillTo} onChange={e => setFillTo(e.target.value.toUpperCase())} title="End address" />
          <span className="mem-toolbar-lbl">with value</span>
          <input className="mem-toolbar-input" placeholder="00" maxLength={2} style={{width:30}}
            value={fillVal} onChange={e => setFillVal(e.target.value.toUpperCase())} title="Fill value" />
          <button className="mem-btn" onClick={runFill}>Fill range</button>
        </div>
      )}
      {showExport && (
        <div className="mem-toolbar mem-toolbar-fill">
          <span className="mem-toolbar-lbl">EXPORT</span>
          <input className="mem-toolbar-input" placeholder="0000" maxLength={4} style={{width:46}}
            autoFocus
            value={exportFrom} onChange={e => setExportFrom(e.target.value.toUpperCase())} title="Start address" />
          <span className="mem-toolbar-lbl">–</span>
          <input className="mem-toolbar-input" placeholder="00FF" maxLength={4} style={{width:46}}
            value={exportTo} onChange={e => setExportTo(e.target.value.toUpperCase())} title="End address" />
          <button className="mem-btn" onClick={runExport}>Download .bin</button>
        </div>
      )}
      <div className="mem-scroll" ref={scrollRef}
        onWheel={e => { e.preventDefault(); const delta = e.deltaY > 0 ? COLS : -COLS; manualJump(Math.max(0, Math.min(0xFFF0, memStart + delta))) }}>
        <table className="mem-tbl">
          <thead>
            <tr>
              <th className="mem-th-addr"></th>
              {Array.from({length:COLS},(_,i)=><th key={i} className="mem-th">{hex2(i)}</th>)}
              <th className="mem-th-ascii mobile-hidden" style={{ paddingLeft: 16, textAlign: 'left' }}>ASCII</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({length:rows},(_,row)=>{
              const base = memStart + row*COLS
              let ascii = ''
              return (
                <tr key={row}>
                  <td className="mem-row-addr">{hex4(base)}</td>
                  {Array.from({length:COLS},(_,col)=>{
                    const addr = base + col
                    const val  = mem[row*COLS+col] ?? 0
                    const isPC     = addr === regs.pc
                    const isSP     = addr === regs.sp
                    const isCursor = addr === cursor
                    const isCode     = !isPC && !isSP && programRegion && addr >= programRegion.start && addr < programRegion.end
                    const isPreset   = !isPC && !isSP && !isCode && presetAddrs?.has(addr)
                    const isMatchCur = searchMatches.length > 0 && addr === searchMatches[searchIdx]
                    const isMatch    = !isMatchCur && searchMatchSet.has(addr)
                    const isFillPrev = !isPC && !isSP && !isMatchCur && !isMatch && previewSet.has(addr)
                    ascii += (val >= 0x20 && val <= 0x7E) ? String.fromCharCode(val) : '.'
                    if (editing === addr)
                      return (
                        <td key={col} className="mem-cell editing">
                          <input autoFocus maxLength={2} value={editBuf}
                            onChange={e=>setEditBuf(e.target.value.toUpperCase())}
                            onFocus={e => e.target.select()}
                            onBlur={()=>commit(addr,editBuf)}
                            onKeyDown={e=>{if(e.key==='Enter')commit(addr,editBuf);if(e.key==='Escape')setEditing(null)}}
                          />
                        </td>
                      )
                    return (
                      <td key={col}
                        className={`mem-cell${isPC?' mem-pc':''}${isSP?' mem-sp':''}${isCode?' mem-code':''}${isPreset?' mem-preset':''}${isCursor?' mem-cursor':''}${val?' mem-nz':''}${changedAddrs?.has(addr)?' mem-diff':''}${isMatchCur?' mem-match-cur':''}${isMatch?' mem-match':''}${isFillPrev?' mem-fill-prev':''}`}
                        title={`${hex4(addr)}: ${hex2(val)}H = ${val}`}
                        onClick={()=>setCursor(addr)}
                        onDoubleClick={()=>{setEditing(addr);setEditBuf(hex2(val))}}
                      >{hex2(val)}</td>
                    )
                  })}
                  <td className="mem-cell-ascii mobile-hidden" style={{ paddingLeft: 16, letterSpacing: '1px', opacity: 0.6, whiteSpace: 'pre' }}>{ascii}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mem-legend">
        <span className="legend-pc">■</span> PC &nbsp;
        <span className="legend-sp">■</span> SP &nbsp;
        <span className="legend-code">■</span> Code &nbsp;
        <span className="legend-preset">■</span> Data &nbsp;
        <span className="legend-tip">double-click to edit · click + ↑↓ PgUp/Dn to scroll</span>
      </div>
    </div>
  )
}