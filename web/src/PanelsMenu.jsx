import { useState, useEffect, useRef } from 'react';

export function PanelsMenu({ panels, onToggle }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const dropRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = e => {
      if (!btnRef.current?.contains(e.target) && !dropRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
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
      <button ref={btnRef} className="btn" onClick={toggle} title="Show/hide panels">
        🪟 Panels <span className="exmenu-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div ref={dropRef} className="bmenu-dropdown" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxHeight: '70vh', overflowY: 'auto' }}>
          {[
            ['regs','Registers'],['pairs','Reg Pairs'],['flags','Flags'],
            ['ints','Interrupts'],['io','I/O Ports'],['memmap','Mem Map'],
            ['audio','Audio'],['ppi','8255 PPI'],['pit','8253 PIT'],
            ['stack','Stack'],['callstack','Call Stack'],['trace','Trace'],
          ].map(([k, l]) => (
            <button key={k} className="bmenu-item" onClick={() => onToggle(k)}><span style={{ display: 'inline-block', width: 16 }}>{panels[k] ? '✓' : ''}</span>{l}</button>
          ))}
        </div>
      )}
    </>
  )
}