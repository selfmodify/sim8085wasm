import { useState, useEffect, useRef } from 'react';

export function HelpMenu({ onShowWelcome, onShowShortcuts, onManageGithub }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="bmenu-wrap bmenu-mobile-hide" ref={wrapRef} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
      <button className="view-tab" onClick={() => setOpen(o => !o)} style={{ padding: '6px 12px', fontWeight: 600 }}>
        ❓ Help {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="exmenu-dropdown" style={{ right: 0, left: 'auto', top: 'calc(100% + 5px)', minWidth: '200px' }} onClick={() => setOpen(false)}>
          <button className="exmenu-sub-item" onClick={onShowWelcome}>📖 Welcome guide</button>
          <button className="exmenu-sub-item" onClick={onShowShortcuts}>⌨ Keyboard shortcuts</button>
          <hr className="exmenu-sep" />
          <button className="exmenu-sub-item" onClick={() => window.open('https://github.com/selfmodify/sim8085', '_blank')}>⭐ View on GitHub</button>
          <button className="exmenu-sub-item" onClick={() => window.open('https://github.com/selfmodify/sim8085/issues/new', '_blank')}>🐛 Report a Bug</button>
          <button className="exmenu-sub-item" onClick={() => window.open('https://github.com/selfmodify/sim8085/discussions', '_blank')}>💬 Ask a Question</button>
          <button className="exmenu-sub-item" onClick={onManageGithub}>🔑 Manage GitHub API Token</button>
          <hr className="exmenu-sep" />
          <button className="exmenu-sub-item" onClick={() => window.open('./privacy.html', '_blank')}>🔒 Privacy Policy</button>
          <button className="exmenu-sub-item" onClick={() => window.open('./terms.html', '_blank')}>📜 Terms of Service</button>
        </div>
      )}
    </div>
  );
}