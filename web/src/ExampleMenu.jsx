import { useState, useEffect, useRef } from 'react';
import { EXAMPLES } from './examples.js';

export function ExampleMenu({ onLoad }) {
  const [open, setOpen]           = useState(false)
  const [activeCat, setActiveCat] = useState(null)
  const [pos, setPos]             = useState({ top: 0, left: 0 })
  const btnRef  = useRef(null)
  const dropRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (!btnRef.current?.contains(e.target) && !dropRef.current?.contains(e.target)) {
        setOpen(false); setActiveCat(null)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler) }
  }, [open])

  const toggle = () => {
    if (!open) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 230) })
    }
    setOpen(o => !o)
  }

  return (
    <>
      <button ref={btnRef} className="btn exmenu-trigger" onClick={toggle}>
        Examples <span className="exmenu-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div ref={dropRef} className="exmenu-dropdown" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}>
          {Object.entries(EXAMPLES).map(([cat, programs], i) => (
            <div key={cat}>
              {['Basic', 'Memory', 'I/O'].includes(cat) && <hr className="exmenu-sep" />}
              <div className={`exmenu-cat${activeCat === cat ? ' exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveCat(cat)} onClick={() => setActiveCat(activeCat === cat ? null : cat)}>
                <span>{cat}</span><span className="exmenu-arrow">▶</span>
                {activeCat === cat && (
                  <div className="exmenu-sub" onClick={e => e.stopPropagation()}>{Object.keys(programs).map(name => (<button key={name} className="exmenu-sub-item" onClick={() => { onLoad(`${cat}::${name}`); setOpen(false); setActiveCat(null) }}>{name}</button>))}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}