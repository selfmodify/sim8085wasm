import { useState, useEffect, useRef } from 'react';

export function BrandMenu({ onShowWelcome, onShowShortcuts, onNew, onImport, onLoadFromDrive, onLoadFromGist, onExport, onExportHex, onExportBin, onSaveToDrive, onSaveAsToDrive, onSaveToGist, onShare, onCalc, onChat, memSize, onMemSize, engineMode, onEngineSwitch, engineSwitching, theme, onTheme, onSetTheme, crtBrightness, onCrtBrightness, crtContrast, onCrtContrast, crtGlitch, onCrtGlitch, onManageGithub, panels, onTogglePanel, activeView, onSetView, driveToken, onConnectDrive, onDriveDisconnect, onBrewCoffee }) {
  const [open, setOpen] = useState(false);
  const [activeSub, setActiveSub] = useState(null);
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (!wrapRef.current?.contains(e.target)) {
        setOpen(false)
        setActiveSub(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function item(label, action) {
    return (
      <button className="bmenu-item" onClick={() => { action(); setOpen(false); setActiveSub(null) }}>
        {label}
      </button>
    )
  }

  return (
    <div className="bmenu-wrap" ref={wrapRef}>
      <button className="brand-chip bmenu-trigger" onClick={() => setOpen(o => !o)} title="Menu">
        <span className="brand-chevron">☰</span><span className="brand-name"> 8085</span>
      </button>
      {open &&
        <div className="bmenu-dropdown" style={{ overflow: 'visible' }} onMouseLeave={() => setActiveSub(null)}>
          <div className={`bmenu-item exmenu-cat bmenu-mobile-only ${activeSub === 'views' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('views')} onClick={() => setActiveSub(activeSub === 'views' ? null : 'views')}>
            <span>🖥  Views</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'views' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                {[['simulator','🖥','Simulator'],['challenges','🏆','Challenges'],['community','🌐','Community Gists']].map(([v,icon,label]) => (
                  <button key={v} className="exmenu-sub-item" onClick={() => { onSetView(v); setOpen(false); setActiveSub(null) }}>
                    <span style={{display:'inline-block',width:16}}>{activeView===v?'✓':''}</span>{icon} {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="bmenu-sep" />
          <div className={`bmenu-item exmenu-cat ${activeSub === 'import' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('import')} onClick={() => setActiveSub(activeSub === 'import' ? null : 'import')}>
            <span>⇡  Import</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'import' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
            <button className="exmenu-sub-item" onClick={() => { onNew(); setOpen(false); setActiveSub(null); }}>📄 New file</button>
                <hr className="exmenu-sep" />
                <button className="exmenu-sub-item" onClick={() => { onImport(); setOpen(false); setActiveSub(null); }}>.asm / .85 source</button>
                <button className="exmenu-sub-item" onClick={() => { onImport(); setOpen(false); setActiveSub(null); }}>.hex / .bin image</button>
                <button className="exmenu-sub-item" onClick={() => { onLoadFromDrive(); setOpen(false); setActiveSub(null); }}>☁ Load from Google Drive</button>
                <button className="exmenu-sub-item" onClick={() => { onLoadFromGist(); setOpen(false); setActiveSub(null); }}>🐙 Load from GitHub Gist</button>
              </div>
            )}
          </div>

          <div className={`bmenu-item exmenu-cat ${activeSub === 'export' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('export')} onClick={() => setActiveSub(activeSub === 'export' ? null : 'export')}>
            <span>⇣  Export</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'export' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                <button className="exmenu-sub-item" onClick={() => { onExport(); setOpen(false); setActiveSub(null); }}>.asm source</button>
                <button className="exmenu-sub-item" onClick={() => { onExportHex(); setOpen(false); setActiveSub(null); }}>.hex (Intel HEX)</button>
                <button className="exmenu-sub-item" onClick={() => { onExportBin(); setOpen(false); setActiveSub(null); }}>.bin (raw binary)</button>
                <button className="exmenu-sub-item" onClick={() => { onSaveToDrive(); setOpen(false); setActiveSub(null); }}>☁ Save to Google Drive</button>
                {driveToken && <button className="exmenu-sub-item" onClick={() => { onSaveAsToDrive?.(); setOpen(false); setActiveSub(null); }}>☁ Save As to Google Drive…</button>}
                <button className="exmenu-sub-item" onClick={() => { onSaveToGist(); setOpen(false); setActiveSub(null); }}>🐙 Save to GitHub Gist</button>
                <button className="exmenu-sub-item" onClick={() => { onShare(); setOpen(false); setActiveSub(null); }}>⎘ Copy share link</button>
              </div>
            )}
          </div>
          <div className="bmenu-sep" />

          {driveToken ? (
            <div className={`bmenu-item exmenu-cat ${activeSub === 'drive' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('drive')} onClick={() => setActiveSub(activeSub === 'drive' ? null : 'drive')}>
              <span>☁  Drive ✓</span>
              <span className="exmenu-arrow">▶</span>
              {activeSub === 'drive' && (
                <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                  <button className="exmenu-sub-item" onClick={() => { onLoadFromDrive(); setOpen(false); setActiveSub(null); }}>📂 Load from Drive…</button>
                  <button className="exmenu-sub-item" onClick={() => { onSaveToDrive(); setOpen(false); setActiveSub(null); }}>💾 Save to Drive</button>
                  <button className="exmenu-sub-item" onClick={() => { onSaveAsToDrive?.(); setOpen(false); setActiveSub(null); }}>📝 Save As…</button>
                  <div className="bmenu-sep" />
                  <button className="exmenu-sub-item" style={{ color: 'var(--text3)' }} onClick={() => { onDriveDisconnect?.(); setOpen(false); setActiveSub(null); }}>🔌 Disconnect</button>
                </div>
              )}
            </div>
          ) : (
            <button className="bmenu-item" onClick={() => { onConnectDrive?.(); setOpen(false); setActiveSub(null); }}>☁  Connect to Google Drive</button>
          )}

          <div className={`bmenu-item exmenu-cat ${activeSub === 'tools' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('tools')} onClick={() => setActiveSub(activeSub === 'tools' ? null : 'tools')}>
            <span>🛠  Tools</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'tools' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                <button className="exmenu-sub-item" onClick={() => { onCalc(); setOpen(false); setActiveSub(null); }}>🖩 Calculator</button>
                <button className="exmenu-sub-item" onClick={() => { onChat(); setOpen(false); setActiveSub(null); }}>🤖 AI Assistant</button>
              </div>
            )}
          </div>

          <div className={`bmenu-item exmenu-cat ${activeSub === 'help' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('help')} onClick={() => setActiveSub(activeSub === 'help' ? null : 'help')}>
            <span>❓  Help &amp; Community</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'help' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                <button className="exmenu-sub-item" onClick={() => { onShowWelcome(); setOpen(false); setActiveSub(null); }}>📖 Welcome guide</button>
                <button className="exmenu-sub-item" onClick={() => { onShowShortcuts(); setOpen(false); setActiveSub(null); }}>⌨ Keyboard shortcuts</button>
                <hr className="exmenu-sep" />
                <button className="exmenu-sub-item" onClick={() => { window.open('https://github.com/selfmodify/sim8085wasm', '_blank'); setOpen(false); setActiveSub(null); }}>⭐ View on GitHub</button>
                <button className="exmenu-sub-item" onClick={() => { window.open('https://github.com/selfmodify/sim8085wasm/issues/new', '_blank'); setOpen(false); setActiveSub(null); }}>🐛 Report a Bug</button>
                <button className="exmenu-sub-item" onClick={() => { window.open('https://github.com/selfmodify/sim8085wasm/discussions', '_blank'); setOpen(false); setActiveSub(null); }}>💬 Ask a Question</button>
                <button className="exmenu-sub-item" onClick={() => { onManageGithub(); setOpen(false); setActiveSub(null); }}>🔑 Manage GitHub API Token</button>
                <hr className="exmenu-sep" />
                <button className="exmenu-sub-item" onClick={() => { window.open('./privacy.html', '_blank'); setOpen(false); setActiveSub(null); }}>🔒 Privacy Policy</button>
                <button className="exmenu-sub-item" onClick={() => { window.open('./terms.html', '_blank'); setOpen(false); setActiveSub(null); }}>📜 Terms of Service</button>
              </div>
            )}
          </div>

          <div className="bmenu-sep" />
          <div className={`bmenu-item exmenu-cat ${activeSub === 'theme' ? 'exmenu-cat-active' : ''}`} onMouseEnter={() => setActiveSub('theme')} onClick={() => setActiveSub(activeSub === 'theme' ? null : 'theme')}>
            <span>🎨  Theme</span>
            <span className="exmenu-arrow">▶</span>
            {activeSub === 'theme' && (
              <div className="exmenu-sub" onClick={e => e.stopPropagation()}>
                {[
                  { id: 'dark',    label: '🌙  Dark'    },
                  { id: 'dim',     label: '🌗  Dim'     },
                  { id: 'dracula', label: '🧛  Dracula' },
                  { id: 'light',   label: '☀︎  Light'   },
                ].map(({ id, label }) => (
                  <button key={id} className="exmenu-sub-item"
                    style={{ color: theme === id ? 'var(--accent)' : undefined,
                             fontWeight: theme === id ? 700 : undefined }}
                    onClick={() => { onSetTheme(id); setOpen(false); setActiveSub(null) }}>
                    {label}
                  </button>
                ))}
                <hr className="exmenu-sep" />
                {[
                  { id: 'amber-mono', label: '🟡  Amber Monochrome' },
                  { id: 'gray-crt',   label: '⬜  Gray Retro CRT'   },
                  { id: 'green',      label: '🟢  Green CRT'        },
                  { id: 'turbo-c',    label: '🟦  Turbo C'          },
                  { id: 'cp437',      label: '🔳  DOS CP437'        },
                ].map(({ id, label }) => (
                  <button key={id} className="exmenu-sub-item"
                    style={{ color: theme === id ? 'var(--accent)' : undefined,
                             fontWeight: theme === id ? 700 : undefined }}
                    onClick={() => { onSetTheme(id); setOpen(false); setActiveSub(null) }}>
                    {label}{theme === id ? '  ✓' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          {['amber-mono', 'gray-crt', 'green', 'turbo-c', 'cp437'].includes(theme) && (
            <>
              <div className="bmenu-setting">
                <span className="bmenu-setting-label">CRT Brightness</span>
                <input type="range" min="0.2" max="2.5" step="0.1" value={crtBrightness}
                  onChange={e => onCrtBrightness(+e.target.value)} className="speed-slider" style={{width:'80px'}}
                  onDoubleClick={() => onCrtBrightness(1)} title="Double-click to reset" />
              </div>
              <div className="bmenu-setting">
                <span className="bmenu-setting-label">CRT Contrast</span>
                <input type="range" min="0.2" max="3.0" step="0.1" value={crtContrast}
                  onChange={e => onCrtContrast(+e.target.value)} className="speed-slider" style={{width:'80px'}}
                  onDoubleClick={() => onCrtContrast(1)} title="Double-click to reset" />
              </div>
              <div className="bmenu-setting">
                <span className="bmenu-setting-label">CRT Interference</span>
                <button className={`btn btn-xs ${crtGlitch !== 'off' ? 'btn-run' : ''}`} onClick={() => onCrtGlitch()}>
                  {({off:'Off',flicker:'Flicker',static:'Static',vsync:'V-Sync',hsync:'H-Sync',chroma:'Chroma',chaos:'Chaos'})[crtGlitch] ?? 'Off'}
                </button>
              </div>
            </>
          )}
          <div className="bmenu-setting">
            <span className="bmenu-setting-label">RAM size</span>
            <select className="bmenu-setting-sel" value={memSize}
              onChange={e => { onMemSize(+e.target.value); setOpen(false) }}>
              <option value={16*1024}>16 KB</option>
              <option value={32*1024}>32 KB</option>
              <option value={64*1024}>64 KB</option>
            </select>
          </div>
          <div className="bmenu-setting">
            <span className="bmenu-setting-label">Engine</span>
            <span style={{display:'flex',gap:3}}>
              {['js','wasm'].map(m => (
                <button key={m} disabled={engineSwitching}
                  className={`bmenu-setting-sel`}
                  style={{
                    cursor: engineSwitching ? 'wait' : 'pointer',
                    borderColor: engineMode === m ? 'var(--accent)' : undefined,
                    color: engineMode === m ? 'var(--accent)' : undefined,
                    fontWeight: engineMode === m ? 700 : 400,
                  }}
                  onClick={() => { onEngineSwitch(m); setOpen(false) }}>
                  {m.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
          <div className="bmenu-sep" />
          <button className="bmenu-item" onClick={() => { onBrewCoffee(); setOpen(false); setActiveSub(null) }}>
            <span style={{ color: 'var(--amber)' }}>☕</span> Brew Virtual Coffee
          </button>
          <div className="bmenu-sep" />
          <div className="bmenu-credits">
            <div>8085 Simulator</div>
            <div>Original: Vijay Kumar · 1995</div>
            <div>Web port: 2026</div>
          </div>
        </div>
      }
    </div>
  )
}