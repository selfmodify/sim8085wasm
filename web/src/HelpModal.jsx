import { useEffect } from 'react';
import { INST_HELP } from './instHelp.js';

export function HelpModal({ instruction, onClose }) {
  const inst = INST_HELP[instruction]
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!inst) return null
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-hd">
          <span className="help-mnem">{instruction}</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">
          <p className="help-brief">{inst.brief}</p>
          <div className="help-meta">
            <span><span className="help-lbl">Flags</span>{inst.flags}</span>
            <span><span className="help-lbl">Size</span>{inst.bytes} byte{inst.bytes !== 1 ? 's' : ''}</span>
            <span><span className="help-lbl">Cycles</span>{inst.cycles}</span>
          </div>
          <p className="help-desc">{inst.desc}</p>
          <pre className="help-ex">{inst.ex}</pre>
        </div>
      </div>
    </div>
  )
}