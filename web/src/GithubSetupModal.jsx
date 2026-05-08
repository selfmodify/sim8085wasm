import { useState, useEffect } from 'react';

export function GithubSetupModal({ onClose, onSave }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const [token, setToken] = useState(() => localStorage.getItem('sim8085_github_token') || '')
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="welcome-modal" style={{ width: 440, maxWidth: '90vw', padding: '20px 24px', display: 'block', height: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="help-hd" style={{ marginBottom: 16, background: 'transparent', border: 'none', padding: 0 }}>
          <span className="help-mnem" style={{ fontSize: 16 }}>GitHub Integration</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 16 }}>
          To save scripts and bypass GitHub's API rate limits, provide a Personal Access Token with the <b>gist</b> scope.
        </p>
        <input className="chat-input" type="password" placeholder="ghp_..." value={token} onChange={e => setToken(e.target.value)} style={{ width: '100%', marginBottom: 16 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a href="https://github.com/settings/tokens/new?scopes=gist&description=sim8085+Simulator" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 12, textDecoration: 'none' }}>Create a token →</a>
          <div>
            {localStorage.getItem('sim8085_github_token') && <button className="btn" style={{ marginRight: 8 }} onClick={() => { localStorage.removeItem('sim8085_github_token'); onSave?.(); onClose(); }}>Clear Token</button>}
            <button className="btn btn-run" onClick={() => { if(token.trim()) localStorage.setItem('sim8085_github_token', token.trim()); onSave?.(); onClose(); }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}