import { useState, useEffect, useRef } from 'react';
import { PanelHelp } from './PanelHelp.jsx';

// ── Lightweight markdown renderer (assistant messages only) ───────────────────
function renderInline(text, key = 0) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g)
  return parts.map((part, i) => {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="chat-md-inline">{part.slice(1, -1)}</code>
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

function renderMarkdown(text) {
  const out = []
  let k = 0
  const segs = text.split(/(```[\w]*\n?[\s\S]*?```)/g)
  for (const seg of segs) {
    if (seg.startsWith('```')) {
      const body = seg.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
      out.push(<pre key={k++} className="chat-md-pre"><code>{body}</code></pre>)
      continue
    }
    for (const block of seg.split(/\n{2,}/)) {
      const lines = block.split('\n')
      const hm = lines[0]?.match(/^(#{1,3})\s+(.+)/)
      if (hm) {
        out.push(<p key={k++} className="chat-md-h">{renderInline(hm[2])}</p>)
        continue
      }
      const listLines = lines.filter(l => /^[ \t]*[-*+]\s|^[ \t]*\d+\.\s/.test(l))
      if (listLines.length > 0 && listLines.length === lines.filter(l => l.trim()).length) {
        out.push(
          <ul key={k++} className="chat-md-ul">
            {listLines.map((l, i) => {
              const m = l.match(/^[ \t]*(?:[-*+]|\d+\.)\s+(.*)/)
              return <li key={i}>{renderInline(m ? m[1] : l)}</li>
            })}
          </ul>
        )
        continue
      }
      const joined = lines.join('\n').trim()
      if (joined) out.push(<p key={k++} className="chat-md-p">{renderInline(joined)}</p>)
    }
  }
  return out
}

const CHAT_SYSTEM = `You are an expert assistant embedded in an Intel 8085 microprocessor simulator. Help users with 8085 assembly language programming, instruction behaviour, register and flag effects, debugging, memory addressing, and general computer architecture. When showing code use 8085 assembly syntax. Be concise and practical.`

export function ChatPanel({ regs, src, symbols, breakpoints, callStack, onClose, onPopout, isPoppedOut }) {
  const [apiKey,    setApiKey]    = useState(() => localStorage.getItem('ant_key') || '')
  const [keyDraft,  setKeyDraft]  = useState('')
  const [setupOpen, setSetupOpen] = useState(!localStorage.getItem('ant_key'))
  const [messages,  setMessages]  = useState([])
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [pos,       setPos]       = useState({ x: Math.max(0, window.innerWidth / 2 - 170), y: 150 })
  const posRef    = useRef(pos)
  const scrollRef = useRef(null)
  const inputRef  = useRef(null)

  function onDragDown(e) {
    if (isPoppedOut) return
    if (e.target.closest('button') || e.target.closest('input')) return
    e.preventDefault()
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y
    function onMove(ev) {
      const p = { x: ev.clientX - ox, y: Math.max(0, ev.clientY - oy) }
      posRef.current = p; setPos(p)
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  function saveKey() {
    const k = keyDraft.trim()
    if (!k) return
    localStorage.setItem('ant_key', k)
    setApiKey(k); setSetupOpen(false); setKeyDraft('')
  }

  function clearKey() {
    localStorage.removeItem('ant_key')
    setApiKey(''); setSetupOpen(true); setMessages([])
  }

  function buildContext() {
    if (!regs) return ''
    const h2 = v => v.toString(16).toUpperCase().padStart(2, '0')
    const h4 = v => v.toString(16).toUpperCase().padStart(4, '0')
    const f = regs.flags ?? 0
    const flags = [
      `S=${(f>>7)&1}`, `Z=${(f>>6)&1}`, `AC=${(f>>4)&1}`,
      `P=${(f>>2)&1}`, `CY=${f&1}`
    ].join(' ')
    const bc = (regs.b << 8) | regs.c
    const de = (regs.d << 8) | regs.e
    const hl = (regs.h << 8) | regs.l
    const lines = [
      `\n\n--- Current simulator state ---`,
      `Registers: A=${h2(regs.a)} B=${h2(regs.b)} C=${h2(regs.c)} D=${h2(regs.d)} E=${h2(regs.e)} H=${h2(regs.h)} L=${h2(regs.l)}`,
      `Pairs: BC=${h4(bc)}  DE=${h4(de)}  HL=${h4(hl)}`,
      `PC=${h4(regs.pc)}  SP=${h4(regs.sp)}`,
      `Flags: ${flags}`,
    ]
    if (symbols && Object.keys(symbols).length > 0) {
      const symList = Object.entries(symbols).map(([k, v]) => `${k}=${h4(v)}H`).join('  ')
      lines.push(`Symbols: ${symList}`)
    }
    if (breakpoints && breakpoints.size > 0) {
      const bpList = [...breakpoints.entries()].map(([a, c]) => c ? `${h4(a)}H[${c}]` : `${h4(a)}H`).join('  ')
      lines.push(`Breakpoints: ${bpList}`)
    }
    if (callStack && callStack.length > 0) {
      lines.push(`Call stack (${callStack.length} frame${callStack.length > 1 ? 's' : ''}): ${callStack.map(f => h4(f.retAddr ?? f)+'H').join(' → ')}`)
    }
    if (src?.trim()) lines.push(`\nCurrent editor source:\n\`\`\`\n${src.trim()}\n\`\`\``)
    return lines.join('\n')
  }

  async function send() {
    const text = input.trim()
    if (!text || loading || !apiKey) return
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next); setInput(''); setLoading(true)
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', // fast + cheap; sufficient for debugging Q&A
          max_tokens: 1024,
          system: CHAT_SYSTEM + buildContext(),
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
      setMessages(m => [...m, { role: 'assistant', content: data.content?.[0]?.text || '' }])
    } catch (err) {
      setMessages(m => [...m, { role: 'error', content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const wrapperClass = isPoppedOut ? 'chat-window' : 'chat-float'
  const wrapperStyle = isPoppedOut ? {} : { left: pos.x, top: pos.y }

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      <div className="chat-float-hd" onMouseDown={onDragDown} style={{ cursor: isPoppedOut ? 'default' : 'move' }}>
        <span><span className="panel-icon">🤖</span>AI ASSISTANT</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button className="reg-base-btn" onClick={() => setSetupOpen(o => !o)} title="API key settings">⚙</button>
          <PanelHelp panel="AI ASSISTANT" />
          {!isPoppedOut && onPopout && (
            <button className="reg-base-btn" onClick={onPopout} title="Open in separate window">⧉</button>
          )}
          {onClose && (
            <button className="chat-float-close" onClick={onClose} title="Close">✕</button>
          )}
        </div>
      </div>

      {setupOpen && (
        <div className="chat-key-setup">
          <p className="chat-key-hint">Your Anthropic API key — stored only in this browser, never sent to any server other than Anthropic.</p>
          <div className="chat-key-row">
            <input className="chat-key-input" type="password" placeholder="sk-ant-…"
              value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveKey()} />
            <button className="btn btn-xs" onClick={saveKey}>Save</button>
          </div>
          {apiKey && <button className="btn btn-xs" onClick={clearKey}>Clear key</button>}
          <a className="chat-key-link" href="https://console.anthropic.com" target="_blank" rel="noreferrer">Get a key at console.anthropic.com →</a>
        </div>
      )}

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !setupOpen &&
          <div className="chat-empty">Ask anything about 8085 assembly…</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            <div className={`chat-bubble${m.role === 'assistant' ? ' chat-bubble-md' : ''}`}>
              {m.role === 'assistant' ? renderMarkdown(m.content) : m.content}
            </div>
          </div>
        ))}
        {loading && <div className="chat-msg chat-msg-assistant"><div className="chat-bubble chat-loading">…</div></div>}
      </div>

      {!setupOpen && (
        <div className="chat-input-row">
          <input ref={inputRef} className="chat-input" placeholder="Ask about 8085…"
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button className="btn btn-xs" onClick={send} disabled={loading || !input.trim()}>Send</button>
        </div>
      )}
    </div>
  )
}
