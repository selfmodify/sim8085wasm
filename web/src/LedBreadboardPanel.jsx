import { useRef, useEffect } from 'react';
import { LedDisplay } from './LedDisplay.jsx';

export function LedBreadboardPanel({ leds, pos, onPosChange }) {
  const posRef = useRef(pos);

  useEffect(() => { posRef.current = pos }, [pos]);

  function onDragDown(e) {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const doc = e.currentTarget.ownerDocument;
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y;
    function onMove(ev) {
      const rawX = ev.clientX - ox;
      const rawY = Math.max(0, ev.clientY - oy);
      const p = { x: Math.round(rawX / 20) * 20, y: Math.round(rawY / 20) * 20 };
      posRef.current = p; onPosChange(p);
    }
    function onUp() { doc.removeEventListener('mousemove', onMove); doc.removeEventListener('mouseup', onUp); }
    doc.addEventListener('mousemove', onMove); doc.addEventListener('mouseup', onUp);
  }

  return (
    <div className="ppi-float" style={{ left: pos.x, top: pos.y }}>
      <div className="ppi-float-hd" onMouseDown={onDragDown}>
        <span><span className="panel-icon">📟</span>LED Display</span>
      </div>
      <div className="ppi-body" style={{ padding: 0, borderBottomLeftRadius: 'var(--radius-sm)', borderBottomRightRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
        <LedDisplay leds={leds} />
      </div>
    </div>
  );
}