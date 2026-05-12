import { useEffect } from 'react';

const WELCOME_FEATURES = [
  { icon: '✏️', title: 'Editor',          desc: 'Write 8085 assembly with syntax highlighting and auto-indent. Ctrl+click any mnemonic for the full instruction reference. Use ASSERT to validate registers, flags, and memory inline — any failure halts with a clear error. Load from 20+ built-in examples across six categories.' },
  { icon: '▶',  title: 'Build & Run',     desc: 'F5 assembles, F7 steps one instruction, F9 runs/pauses, F6 resets. ⟲ Back undoes the last step. Nine speed modes from Auto-Step (classroom pace) through Turbo++ to Warp, which runs flat-out until HLT, updating the UI only once per second for maximum throughput. Switch between the JS and WASM engine from the ☰ menu to compare throughput.' },
  { icon: '📋', title: 'Disassembly',     desc: 'Live disassembly follows the program counter. Click any row to toggle a breakpoint — execution pauses automatically when PC hits it.' },
  { icon: '🧠', title: 'CPU State',       desc: 'Registers, flags, and register pairs update live and highlight green on every change. Click any register pair to jump the memory view to that address. Values are editable in place.' },
  { icon: '💾', title: 'Memory',          desc: 'Browse and edit all of RAM in the hex editor. Double-click any cell to change it. RAM size is configurable (16 / 32 / 64 KB) in the menu.' },
  { icon: '🔍', title: 'Analysis Tools',  desc: 'Debug with precision using the live Call Stack, Execution Trace, graphical Memory Map, and Watch variables. Use the ASCII Console to view serial output.' },
  { icon: '🕹️', title: 'I/O & Peripherals', desc: 'Interact with the 8255 PPI, 8253 PIT, Audio Output, and 7-segment LED display. Set input ports for the IN instruction, and queue keystrokes for CALL 5 C=01H syscalls.' },
  { icon: '🔔', title: 'Interrupts',      desc: 'Fire TRAP, RST 7.5, RST 6.5, or RST 5.5 mid-program with the FIRE buttons. Control the interrupt flip-flop via EI/DI/SIM/RIM. HLT pauses and resumes on the next interrupt.' },
  { icon: '🌐', title: 'Community & Challenges', desc: 'Solve auto-verified coding challenges, or explore and share 8085 scripts via GitHub Gists.' },
  { icon: '☁️', title: 'Cloud Sync',      desc: 'Connect your Google Drive or provide a GitHub API token to seamlessly save, load, and share your 8085 programs across devices.' },
  { icon: '🖩', title: 'Calculator',      desc: 'Convert values between binary, octal, decimal, and hex — handy when working out immediate operands or memory addresses.' },
  { icon: '🤖', title: 'AI Assistant',    desc: 'Enter your Anthropic API key (stored only in your browser, never sent to any server) to ask questions about 8085 assembly directly in the app.' },
  { icon: '🪟', title: 'Customizable Layout', desc: 'Drag panel headers in the center and right columns to rearrange your workspace. Your custom layout is saved automatically.' },
]

export function WelcomeModal({ onClose, onBrewCoffee }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="welcome-modal" onClick={e => e.stopPropagation()}>
        <div className="welcome-hd">
          <div className="welcome-logo">
            <div className="brand-chip" style={{fontSize:'22px',padding:'10px 14px',lineHeight:'1'}}>8085</div>
            <div>
              <div className="welcome-title">8085 Simulator</div>
              <div className="welcome-sub">Intel 8085 microprocessor simulator — running in your browser</div>
            </div>
          </div>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="welcome-grid">
          {WELCOME_FEATURES.map(f => (
            <div key={f.title} className="welcome-card">
              <span className="welcome-icon">{f.icon}</span>
              <div>
                <div className="welcome-card-title">{f.title}</div>
                <div className="welcome-card-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="welcome-footer">
          <span className="welcome-tip">
            💡 Start with Examples → I/O → LED Count to see the display in action, or Examples → Interrupts → TRAP to try the interrupt system.<br/>
            💡 You can link directly to examples using the URL hash (e.g. <code>#example=LED_Count</code>).<br/>
            <a href="./privacy.html" target="_blank" rel="noreferrer" style={{ color: 'inherit', display: 'inline-block', marginTop: 6 }}>Privacy Policy</a>
            <span style={{ margin: '0 8px', opacity: 0.5 }}>|</span>
            <span onClick={onBrewCoffee} style={{ color: 'var(--amber)', display: 'inline-block', marginTop: 6, fontWeight: 600, cursor: 'pointer' }}>☕ Brew Virtual Coffee</span>
          </span>
          <button className="btn welcome-btn" onClick={onClose}>Got it, let's go →</button>
        </div>
      </div>
    </div>
  )
}