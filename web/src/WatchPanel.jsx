import { useState } from 'react';
import * as sim from './simProxy.js';
import { PanelHelp } from './PanelHelp.jsx';
import { hex4, fmtWord, fmtByte, BASE_CYCLE } from './utils.js';
import { useSimulator } from './SimulatorContext.jsx';

export function WatchPanel({ watches, regs, onAdd, onRemove, dataBps, onToggleBreak }) {
  const { regBase, onRegBase } = useSimulator()
  const [input, setInput] = useState('')
  const PAIR_KEYS = { bc: ['b','c'], de: ['d','e'], hl: ['h','l'] }
  const REG_NAMES = new Set(['a','b','c','d','e','h','l','pc','sp','flags','bc','de','hl'])

  function getValue(w) {
    if (w.type === 'reg') {
      const p = PAIR_KEYS[w.key]
      if (p) return (regs[p[0]] << 8) | regs[p[1]]
      return regs[w.key] ?? 0
    }
    return sim.simReadByte(w.addr)
  }

  function is16(w) {
    return w.type === 'mem' || ['pc','sp','bc','de','hl'].includes(w.key)
  }

  function addWatch() {
    const s = input.trim().toLowerCase()
    if (!s) return
    if (REG_NAMES.has(s)) {
      if (!watches.find(w => w.type === 'reg' && w.key === s))
        onAdd({ type: 'reg', key: s })
    } else {
      const addr = parseInt(s.replace(/h$/,''), 16)
      if (!isNaN(addr))
        onAdd({ type: 'mem', addr: addr & 0xFFFF })
    }
    setInput('')
  }

  return (
    <div className="panel watch-panel">
      <div className="panel-hd">
        <span className="panel-icon">👁</span>WATCH
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="WATCH" />
        </div>
      </div>
      <div className="watch-add-row">
        <input className="watch-input" value={input} placeholder="A  BC  0200H…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addWatch()} />
        <button className="btn btn-xs" onClick={addWatch}>+</button>
      </div>
      <div className="watch-body">
        {watches.length === 0
          ? <div className="watch-empty">Type a register or address above</div>
          : watches.map((w, i) => {
              const v = getValue(w)
              const label = w.type === 'reg' ? w.key.toUpperCase() : hex4(w.addr) + 'H'
              const isBrk = w.type === 'mem' && dataBps?.has(w.addr)
              return (
                <div key={w.type === 'reg' ? `reg-${w.key}` : `mem-${w.addr}`} className="watch-row">
                  <span className="watch-label">{label}</span>
                  <span className="watch-val">{is16(w) ? fmtWord(v, regBase) : fmtByte(v, regBase)}</span>
                  {(regBase||'hex') === 'hex' && <span className="watch-dec">{v}</span>}
                  {w.type === 'mem' && (
                    <button className={`watch-brk${isBrk ? ' active' : ''}`}
                      title={isBrk ? 'Break on write: ON — click to disable' : 'Break on write: OFF — click to enable'}
                      onClick={() => onToggleBreak?.(w.addr)}>W</button>
                  )}
                  <button className="watch-rm" onClick={() => onRemove(i)}>✕</button>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}