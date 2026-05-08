import { useCollapsible } from './hooks.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4 } from './utils.js';

export function CallStackPanel({ callStack, onJump, dragHandleProps, dropTargetProps, isDragOver }) {
  const [collapsed, toggleCollapsed] = useCollapsible('callstack', true)
  return (
    <div className={`panel callstack-panel${isDragOver ? ' drag-over' : ''}`} {...dropTargetProps}>
      <div className="panel-hd collapsible" onClick={toggleCollapsed} {...dragHandleProps}>
        <span className="panel-icon">📞</span>CALL STACK
        {callStack.length > 0 && <span className="callstack-depth">{callStack.length}</span>}
        <div className="panel-hd-right" onClick={e => e.stopPropagation()} style={{marginLeft: 'auto'}}>
          <PanelHelp panel="CALL STACK" />
        </div>
        <span className="panel-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="panel-anim-body">
          {callStack.length === 0
            ? <div className="callstack-empty">— empty (step to populate) —</div>
            : <div className="callstack-list">
                {[...callStack].reverse().map((frame, i) => (
                  <div key={`${frame.targetAddr}-${frame.callAddr}-${i}`} className={`callstack-row${i === 0 ? ' callstack-top' : ''}`}>
                    <span className="callstack-target" title="Target address" onClick={() => onJump(frame.targetAddr)}>{hex4(frame.targetAddr)}H</span>
                    <span className="callstack-arrow">←</span>
                    <span className="callstack-site" title="Call site" onClick={() => onJump(frame.callAddr)}>{hex4(frame.callAddr)}H</span>
                    <span className="callstack-ret" title="Return address">ret:{hex4(frame.retAddr)}H</span>
                  </div>
                ))}
              </div>
          }
        </div>
      )}
    </div>
  )
}