import { useEffect } from 'react';

const SHORTCUTS = [
  { group: 'Toolbar',
    rows: [
      { keys: ['F5'],           desc: 'Assemble (Build)' },
      { keys: ['F7'],           desc: 'Step one instruction' },
      { keys: ['F8'],           desc: 'Step over call/subroutine' },
      { keys: ['F10'],          desc: 'Step out of current subroutine' },
      { keys: ['F9'],           desc: 'Run / Stop' },
      { keys: ['Ctrl', '↵'],   desc: 'Run / Stop' },
      { keys: ['Esc'],          desc: 'Stop (while running)' },
      { keys: ['F6'],           desc: 'Reset (re-assemble from source)' },
    ]
  },
  { group: 'Editor',
    rows: [
      { keys: ['Ctrl', 'F'],    desc: 'Find / Replace' },
      { keys: ['Ctrl', 'Z'],    desc: 'Undo' },
      { keys: ['Ctrl', 'Y'],    desc: 'Redo' },
      { keys: ['Ctrl', 'click'],desc: 'Open instruction reference' },
      { keys: ['Right-click'],  desc: 'Run to this line (after assembly)' },
    ]
  },
  { group: 'Memory panel',
    rows: [
      { keys: ['↑ ↓ ← →'],     desc: 'Move cursor' },
      { keys: ['PgUp / PgDn'],  desc: 'Page up / down' },
      { keys: ['Enter'],        desc: 'Edit byte at cursor' },
      { keys: ['Esc'],          desc: 'Cancel edit' },
    ]
  },
  { group: 'Disassembly panel',
    rows: [
      { keys: ['Click gutter'], desc: 'Toggle breakpoint' },
      { keys: ['Right-click'],  desc: 'Set conditional breakpoint / Run to' },
      { keys: ['↑ ↓ PgUp PgDn'],desc: 'Scroll view manually' },
      { keys: ['Home / End'],   desc: 'Jump to start / end of memory' },
    ]
  },
  { group: 'Global',
    rows: [
      { keys: ['?'],            desc: 'Show this keyboard shortcuts reference' },
      { keys: ['Esc'],          desc: 'Stop execution (if running) / close modal' },
    ]
  },
]

export function ShortcutsModal({ onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' || e.key === '?') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="help-hd">
          <span className="help-mnem">Keyboard Shortcuts</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUTS.map(g => (
            <div key={g.group} className="shortcuts-group">
              <div className="shortcuts-group-hd">{g.group}</div>
              {g.rows.map(r => (
                <div key={r.desc} className="shortcuts-row">
                  <span className="shortcuts-keys">
                    {r.keys.map((k, i) => <kbd key={i} className="shortcuts-kbd">{k}</kbd>)}
                  </span>
                  <span className="shortcuts-desc">{r.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}