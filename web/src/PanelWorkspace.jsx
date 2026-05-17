import { useState, useRef, useMemo } from 'react'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import * as sim from './simProxy.js'
import { PanelHelp } from './PanelHelp.jsx'
import { useCollapsible } from './hooks.js'
import { RegPanel } from './RegPanel.jsx'
import { PairPanel } from './PairPanel.jsx'
import { FlagPanel } from './FlagPanel.jsx'
import { AsmEditor } from './AsmEditor.jsx'
import { MemPanel } from './MemPanel.jsx'
import { DisasmPanel } from './DisasmPanel.jsx'
import { CallStackPanel } from './CallStackPanel.jsx'
import { WatchPanel } from './WatchPanel.jsx'
import { StackPanel } from './StackPanel.jsx'
import { TracePanel } from './TracePanel.jsx'
import { IOPortPanel } from './IOPortPanel.jsx'
import { ConsolePanel } from './ConsolePanel.jsx'
import { AudioPanel } from './AudioPanel.jsx'
import { MemMapPanel } from './MemMapPanel.jsx'
import { InterruptPanel } from './InterruptPanel.jsx'
import { LedDisplay } from './LedDisplay.jsx'
import { HelpPanel } from './HelpPanel.jsx'

export function PanelWorkspace({ mobileTab, theme, src, setSrc, srcRef, engine, panels, setAppDialog, setHelpInst, formatCode, openConditionDialog, readOnlySource }) {
  const [cursorInst, setCursorInst] = useState(null)
  const gotoLineRef = useRef(null)
  const [disasmFlashReq, setDisasmFlashReq] = useState(null)
  const [memFlashReq,   setMemFlashReq]   = useState(null)

  const [editorCollapsed, toggleEditorCollapsed] = useCollapsible('editor', false)
  const [draggedPanel, setDraggedPanel] = useState(null)
  const [dragOverPanel, setDragOverPanel] = useState(null)
  const [rightPanelOrder, setRightPanelOrder] = useState(() => {
    const defaultOrder = ['regs', 'pairs', 'flags', 'ints', 'io', 'memmap', 'audio']
    try { 
      const saved = JSON.parse(localStorage.getItem('sim8085_right_panels')) || []
      const missing = defaultOrder.filter(k => !saved.includes(k))
      return saved.concat(missing)
    }
    catch { return defaultOrder }
  })
  
  const watchedWords = useMemo(() => {
    const list = new Set()
    for (const w of engine.watches) {
      if (w.type === 'reg') {
        list.add(w.key.toUpperCase())
      } else if (w.type === 'mem') {
        list.add(w.addr.toString(16).padStart(4, '0').toUpperCase() + 'H')
        for (const [sym, addr] of Object.entries(engine.symbols || {})) {
          if (addr === w.addr) list.add(sym.toUpperCase())
        }
      }
    }
    return [...list]
  }, [engine.watches, engine.symbols])

  const [centerPanelOrder, setCenterPanelOrder] = useState(() => {
    const defaultOrder = ['stack', 'callstack', 'trace']
    try { 
      const saved = JSON.parse(localStorage.getItem('sim8085_center_panels')) || []
      const missing = defaultOrder.filter(k => !saved.includes(k))
      return saved.concat(missing)
    }
    catch { return defaultOrder }
  })

  function getDragProps(id, orderList, setOrderList, storageKey) {
    return {
      dragHandleProps: {
        draggable: true,
        title: "Drag to reorder",
        onDragStart: (e) => {
          setDraggedPanel(id)
          e.dataTransfer.effectAllowed = 'move'
          const panel = e.currentTarget.closest('.panel')
          if (panel) { e.dataTransfer.setDragImage(panel, 20, 20); setTimeout(() => { panel.style.opacity = '0.4' }, 0) }
        },
        onDragEnd: (e) => {
          const panel = e.currentTarget.closest('.panel')
          if (panel) panel.style.opacity = '1'
          setDraggedPanel(null)
          setDragOverPanel(null)
        }
      },
      dropTargetProps: {
        onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (draggedPanel && draggedPanel !== id && orderList.includes(draggedPanel)) setDragOverPanel(id) },
        onDragLeave: (e) => { if (dragOverPanel === id) setDragOverPanel(null) },
        onDrop: (e) => {
          e.preventDefault(); const panel = e.currentTarget.closest('.panel'); if (panel) panel.style.opacity = '1'
          setDragOverPanel(null)
          if (draggedPanel && draggedPanel !== id && orderList.includes(draggedPanel)) {
            setOrderList(prev => {
              const next = [...prev]; const from = next.indexOf(draggedPanel); const to = next.indexOf(id)
              if (from === -1 || to === -1) return prev; next.splice(from, 1); next.splice(to, 0, draggedPanel)
              localStorage.setItem(storageKey, JSON.stringify(next)); return next
            })
          }
          setDraggedPanel(null)
        }
      },
      isDragOver: dragOverPanel === id
    }
  }

  const editorColRef = useRef(null)
  const rightColRef  = useRef(null)
  const memWatchMemRef   = useRef(null)
  const memWatchWatchRef = useRef(null)
  const disasmStackRef   = useRef(null)

  function onEditorResizeDown(e) {
    e.preventDefault(); const startX = e.clientX; const startW = editorColRef.current.getBoundingClientRect().width
    function onMove(ev) { editorColRef.current.style.flexBasis = Math.max(180, Math.min(640, startW + (ev.clientX - startX))) + 'px' }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }
  function onRightResizeDown(e) {
    e.preventDefault(); const startX = e.clientX; const startW = rightColRef.current.getBoundingClientRect().width
    function onMove(ev) { rightColRef.current.style.flexBasis = Math.max(160, Math.min(600, startW - (ev.clientX - startX))) + 'px' }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }
  function onMemWatchDividerDown(e) {
    e.preventDefault(); const startX = e.clientX; const startW = memWatchMemRef.current?.getBoundingClientRect().width || 0
    function onMove(ev) { if(memWatchMemRef.current) memWatchMemRef.current.style.flex = `0 0 ${Math.max(80, startW + (ev.clientX - startX))}px` }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }
  function onDisasmStackDividerDown(e) {
    e.preventDefault(); const startX = e.clientX; const startW = document.querySelector('.disasm-trace-stack')?.getBoundingClientRect().width || 0
    function onMove(ev) { const stack = document.querySelector('.disasm-trace-stack'); if(stack) stack.style.flex = `0 0 ${Math.max(100, startW - (ev.clientX - startX))}px` }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="workspace">
      {/* Editor column */}
      <div className={`col col-editor${mobileTab!=='editor' ? ' mobile-hidden' : ''}`} ref={editorColRef}>
        <div className="panel editor-panel" style={editorCollapsed ? { flex: 'none' } : undefined}>
          <div className="panel-hd collapsible" onClick={toggleEditorCollapsed}>
            <span><span className="panel-icon">✏️</span>EDITOR</span>
            <div className="panel-hd-right" onClick={e => e.stopPropagation()}>
              <button className="reg-base-btn" onClick={formatCode} title="Auto-format code alignment">Format</button>
              <PanelHelp panel="EDITOR" />
            </div>
            <span className="panel-chevron">{editorCollapsed ? '▶' : '▼'}</span>
          </div>
          {!editorCollapsed && (
            <AsmEditor value={src} onChange={v => { srcRef.current = v; setSrc(v) }} gotoRef={gotoLineRef}
              onCursorInstruction={setCursorInst} onInstructionDetail={setHelpInst}
              errorLine={engine.errorLine} activeLine={engine.addrLineMap?.get(engine.regs?.pc)} onRunTo={engine.runToAddr} onJumpMem={(addr) => { engine.setMemStart(addr & 0xFFF0); setMemFlashReq({ addr, ts: Date.now() }) }} buildId={engine.buildId} lineAddrRef={engine.lineAddrRef} theme={theme} watchedWords={watchedWords}
              bps={engine.bps} onToggleBp={engine.toggleBp}
              onAddressClick={(addr) => setDisasmFlashReq({ addr, ts: Date.now() })}
              onFormat={formatCode} />
          )}
        </div>
        <HelpPanel instruction={cursorInst} />
        <LedDisplay leds={engine.leds} />
      </div>
      <div className="col-resize-handle" onMouseDown={onEditorResizeDown} />

      {/* Code + Memory column */}
      <div className={`col col-center${mobileTab!=='code' ? ' mobile-hidden' : ''}`}>
        <div className="disasm-trace-row">
          <DisasmPanel regs={engine.regs} breakpoints={engine.bps} onToggleBp={engine.toggleBp} onClearAllBps={engine.clearAllBps} buildId={engine.buildId} pcFlash={engine.pcFlash}
            onSetCondition={openConditionDialog} onRunTo={engine.runToAddr} symbols={engine.symbols} onJumpMem={engine.setMemStart} hitcnts={engine.hitcnts} maxHit={engine.maxHit} flashReq={disasmFlashReq}
            onGotoLine={(addr, labelName) => { const ln = engine.addrLineMap.get(addr); if (ln) gotoLineRef.current?.(ln, labelName) }} />
          {(panels.stack || panels.callstack || panels.trace) && (
            <>
              <div className="mem-watch-divider" onMouseDown={onDisasmStackDividerDown} />
              <div className="disasm-trace-stack" ref={disasmStackRef}>
                {centerPanelOrder.map(key => {
                  if (!panels[key]) return null;
                  const dp = getDragProps(key, centerPanelOrder, setCenterPanelOrder, 'sim8085_center_panels')
                  if (key === 'stack') return <ErrorBoundary key={key}><StackPanel regs={engine.regs} {...dp} /></ErrorBoundary>
                if (key === 'callstack') return <ErrorBoundary key={key}><CallStackPanel callStack={engine.callStack} onJump={engine.setMemStart} onGotoLine={(addr) => { const ln = engine.addrLineMap?.get(addr); if (ln) gotoLineRef.current?.(ln); }} {...dp} /></ErrorBoundary>
                  if (key === 'trace') return <ErrorBoundary key={key}><TracePanel trace={engine.trace} onClear={() => engine.setTrace([])} {...dp} /></ErrorBoundary>
                  return null
                })}
              </div>
            </>
          )}
        </div>
        <div className="mem-watch-row">
          <div className="mem-watch-mem" ref={memWatchMemRef}>
            <MemPanel memStart={engine.memStart} onJump={engine.setMemStart} regs={engine.regs} buildId={engine.buildId} changedAddrs={engine.changedAddrs} programRegion={engine.programRegion} presetAddrs={engine.presetAddrs} onMemoryEdited={() => engine.setBuildId(id => id + 1)} memVisibleRangeRef={engine.memVisibleRangeRef} flashReq={memFlashReq} />
          </div>
          <div className="mem-watch-divider" onMouseDown={onMemWatchDividerDown} />
          <div className="mem-watch-watch" ref={memWatchWatchRef}>
            <WatchPanel watches={engine.watches} regs={engine.regs} prevRegs={engine.prevRegs} changedAddrs={engine.changedAddrs} onAdd={w => engine.setWatches(ws => [...ws, w])} onRemove={i => { const w = engine.watches[i]; if (w.type === 'mem' && engine.dataBps.has(w.addr)) { sim.simClearDataBreakpoint(w.addr); engine.setDataBps(prev => { const n = new Set(prev); n.delete(w.addr); return n }) }; engine.setWatches(ws => ws.filter((_,j) => j !== i)) }} dataBps={engine.dataBps} onToggleBreak={engine.toggleDataBp} />
            <ConsolePanel output={engine.consoleOutput} port={engine.consolePort} onSetPort={engine.changeConsolePort} onClear={() => { sim.simClearConsoleOutput(); engine.setConsoleOutput('') }} />
          </div>
        </div>
        <div className="jump-row">
          <button className="btn btn-xs" onClick={()=>engine.setMemStart(engine.regs.pc & 0xFFF0)}>→ PC</button>
          <button className="btn btn-xs" onClick={()=>engine.setMemStart(engine.regs.sp & 0xFFF0)}>→ SP</button>
          <button className="btn btn-xs" onClick={()=>engine.setMemStart(0x100)}>→ 100H</button>
          <button className="btn btn-xs" onClick={()=>engine.setMemStart(0x200)}>→ 200H</button>
        </div>
      </div>
      <div className="col-resize-handle" onMouseDown={onRightResizeDown} />

      {/* Registers column */}
      <div className={`col col-right${mobileTab!=='regs' ? ' mobile-hidden' : ''}`} ref={rightColRef}>
        {rightPanelOrder.map(key => {
          if (!panels[key]) return null;
          const dp = getDragProps(key, rightPanelOrder, setRightPanelOrder, 'sim8085_right_panels')
          if (key === 'regs')   return <ErrorBoundary key={key}><RegPanel regs={engine.regs} prev={engine.prevRegs} onJump={engine.setMemStart} {...dp} /></ErrorBoundary>
          if (key === 'pairs')  return <ErrorBoundary key={key}><PairPanel regs={engine.regs} prev={engine.prevRegs} onJump={engine.setMemStart} onMemoryEdited={() => engine.setBuildId(id => id + 1)} {...dp} /></ErrorBoundary>
          if (key === 'flags')  return <ErrorBoundary key={key}><FlagPanel regs={engine.regs} {...dp} /></ErrorBoundary>
          if (key === 'ints')   return <ErrorBoundary key={key}><InterruptPanel intState={engine.intState} onAssert={engine.assertInterrupt} onDeassert={engine.deassertInterrupt} {...dp} /></ErrorBoundary>
          if (key === 'io')     return <ErrorBoundary key={key}><IOPortPanel outputPorts={engine.outputPorts} inputPresets={engine.inputPresets} onSetInput={engine.setInputPort} onRemoveInput={engine.removeInputPort} keyQueue={engine.keyQueue} onEnqueueKeys={engine.enqueueKeys} onClearKeyQueue={engine.clearKeyQueue} sid={engine.sid} sod={engine.sod} onSetSID={v => { sim.simSetSID(v); engine.setSid(v); }} {...dp} /></ErrorBoundary>
          if (key === 'memmap') return <ErrorBoundary key={key}><MemMapPanel regs={engine.regs} programRegion={engine.programRegion} presetAddrs={engine.presetAddrs} onJump={engine.setMemStart} onGotoLine={(addr) => { const ln = engine.addrLineMap?.get(addr); if (ln) gotoLineRef.current?.(ln); }} {...dp} /></ErrorBoundary>
          if (key === 'audio')  return <ErrorBoundary key={key}><AudioPanel outputPorts={engine.outputPorts} running={engine.running} onShowDialog={setAppDialog} {...dp} /></ErrorBoundary>
          return null
        })}
      </div>
    </div>
  )
}