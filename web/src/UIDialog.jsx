import { useState, useEffect, useRef } from 'react';

export function UIDialog({ dialog, onClose }) {
  const [input, setInput] = useState(dialog.defaultValue || '')
  const [msg, setMsg] = useState(dialog.message || '')
  const inputRef = useRef(null)
  useEffect(() => {
    if (dialog.type === 'prompt' && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [dialog])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') handleCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dialog.frames && dialog.frames.length > 0) {
      let i = 0;
      const interval = setInterval(() => {
        i = (i + 1) % dialog.frames.length;
        setMsg(dialog.frames[i]);
      }, dialog.animationSpeed || 300);
      return () => clearInterval(interval);
    }
  }, [dialog])

  function handleConfirm() {
    if (dialog.onConfirm) dialog.onConfirm(dialog.type === 'prompt' ? input : undefined)
    onClose()
  }

  function handleCancel() {
    if (dialog.onCancel) dialog.onCancel()
    onClose()
  }

  return (
    <div className="help-overlay" onClick={handleCancel} style={{ zIndex: 9999 }}>
      <div className="welcome-modal" style={{ width: 440, maxWidth: '90vw', height: 'auto', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="help-hd" style={{ padding: '12px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
          <span className="help-mnem" style={{ fontSize: 16 }}>{dialog.title || 'Message'}</span>
          <button className="help-close" onClick={handleCancel}>✕</button>
        </div>
        <div style={{ padding: '20px 16px' }}>
          <p style={{ color: 'var(--text2)', fontSize: 14, whiteSpace: 'pre-wrap', marginBottom: dialog.type === 'prompt' ? 16 : 0, fontFamily: 'var(--sans)' }}>{msg || dialog.message}</p>
          {dialog.type === 'prompt' && <input ref={inputRef} className="chat-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleConfirm()} style={{ width: '100%', fontSize: 14, padding: '6px 8px' }} />}
        </div>
        <div style={{ padding: '12px 16px', background: 'var(--bg2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {dialog.type !== 'alert' && <button className="btn" onClick={handleCancel}>{dialog.cancelText || 'Cancel'}</button>}
          <button className="btn btn-run" onClick={handleConfirm}>{dialog.confirmText || 'OK'}</button>
        </div>
      </div>
    </div>
  )
}