import { useEffect } from 'react';

export function DriveLoadModal({ files, loading, onClose, onSelect, onDelete }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '90vw' }}>
        <div className="help-hd">
          <span className="help-mnem">Load from "sim8085" Folder</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-body" style={{ padding: 0, maxHeight: '50vh' }}>
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>Loading files from "sim8085" folder…</div>
          ) : files.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)' }}>No files found in the "sim8085" folder.</div>
          ) : files.map(f => (
            <div key={f.id} style={{ display: 'flex', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <button className="bmenu-item" style={{ flex: 1, borderBottom: 'none' }} onClick={() => onSelect(f.id, f.name)}>
                📄 <span style={{ opacity: 0.5, marginRight: 4 }}>sim8085/</span>{f.name}
              </button>
              <button className="watch-rm" style={{ margin: '0 12px', fontSize: 13, padding: '4px 6px' }} onClick={(e) => { e.stopPropagation(); onDelete(f.id, f.name); }} title="Delete from Google Drive">🗑</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}