import { useState, useEffect } from 'react';

export function CommunityView({ onSelect, githubToken }) {
  const [username, setUsername] = useState('selfmodify')
  const [scripts, setScripts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function fetchScripts(user, signal = null) {
    if (!user) return
    setLoading(true)
    setError(null)
    setScripts([])
    try {
      const headers = githubToken ? { 'Authorization': `token ${githubToken}` } : {}
      const res = await fetch(`https://api.github.com/users/${user}/gists`, { headers, signal })
      if (!res.ok) throw new Error('User not found or GitHub API limit reached')
      const data = await res.json()
      const valid = []
      for (const g of data) {
        const files = Object.values(g.files)
        const asmFile = files.find(f => f.filename.toLowerCase().endsWith('.asm') || f.filename.toLowerCase().endsWith('.85'))
        if (asmFile) {
          valid.push({ id: g.id, title: g.description || asmFile.filename, author: g.owner?.login || user, desc: asmFile.filename })
        }
      }
      if (!signal?.aborted) setScripts(valid)
    } catch (e) { 
      if (e.name !== 'AbortError') setError(e.message) 
    }
    finally { if (!signal?.aborted) setLoading(false) }
  }

  useEffect(() => { 
    const controller = new AbortController()
    fetchScripts(username, controller.signal)
    return () => controller.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="challenges-view">
      <div className="challenges-container">
        <div style={{display:'flex', alignItems:'center', gap: 12, marginBottom: 10}}>
          <span style={{fontSize: 32}}>🌐</span>
          <div style={{flex: 1}}>
            <h1 style={{color: 'var(--text)', fontFamily:'var(--mono)', fontSize: 24, letterSpacing: 1}}>COMMUNITY GALLERY</h1>
            <p style={{color: 'var(--text2)', fontSize: 14}}>Explore and run 8085 assembly scripts shared via public GitHub Gists.</p>
          </div>
          <div style={{display:'flex', gap: 6}}>
            <input className="chat-input" placeholder="GitHub username" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchScripts(username)} style={{width: 160}} />
            <button className="btn" onClick={() => fetchScripts(username)} disabled={loading}>Fetch</button>
          </div>
        </div>
        <div style={{ background: 'var(--bg2)', padding: '14px 18px', borderRadius: 'var(--radius-md)', marginBottom: '20px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8, fontFamily: 'var(--mono)', fontWeight: 700 }}>WHAT IS A GITHUB GIST?</div>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 8 }}>
            A <strong>Gist</strong> is a quick way to share code snippets on GitHub. This Community tab lets you easily discover and run 8085 assembly programs shared by other developers!
          </p>
          <ul style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, paddingLeft: 20 }}>
            <li style={{ marginBottom: 4 }}><strong>To share your code:</strong> Click <em>Export ⇣ → 🐙 Save to GitHub Gist</em>. Your code will instantly become a public Gist.</li>
            <li><strong>To find code:</strong> Type any GitHub username in the search box above to fetch all their shared <code>.asm</code> or <code>.85</code> files.</li>
          </ul>
        </div>
        {loading && <div style={{color: 'var(--text3)', textAlign: 'center', padding: 40}}>Fetching Gists from GitHub...</div>}
        {error && <div style={{color: 'var(--red)', textAlign: 'center', padding: 40}}>✗ {error}</div>}
        {!loading && !error && scripts.length === 0 && <div style={{color: 'var(--text3)', textAlign: 'center', padding: 40}}>No .asm or .85 Gists found for this user.</div>}
        <div className="challenge-grid">
          {scripts.map(g => (
            <div key={g.id} className="challenge-card" onClick={() => onSelect(g.id)}>
              <div className="challenge-title">{g.title}</div>
              <div style={{fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: -4}}>by @{g.author}</div>
              <div className="challenge-desc">{g.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}