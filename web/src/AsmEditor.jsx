import { useState, useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration, GutterMarker, gutter, ViewPlugin, hoverTooltip } from '@codemirror/view';
import { EditorState, StateEffect, StateField, RangeSetBuilder, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { INST_HELP } from './instHelp.js';
import { hex4 } from './utils.js';
import { asm8085Lang, asm8085Highlighting } from './lang.js';

// ── CM6 error-line decoration + gutter marker ─────────────────────────────
const setErrorLineEff = StateEffect.define()
const setActiveLineEff = StateEffect.define()
const setAddressesEff = StateEffect.define()
const setWatchedWordsEff = StateEffect.define()
const flashLineEff = StateEffect.define()

const watchMark = Decoration.mark({ class: 'cm-watched-word' })
const watchHighlightPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.words = new Set()
    this.decorations = Decoration.none
  }
  update(update) {
    let changed = false
    for (const tr of update.transactions) {
      for (const e of tr.effects) {
        if (e.is(setWatchedWordsEff)) {
          this.words = new Set(e.value)
          changed = true
        }
      }
    }
    if (update.docChanged || update.viewportChanged || changed) {
      this.decorations = this.buildDeco(update.view)
    }
  }
  buildDeco(view) {
    if (this.words.size === 0) return Decoration.none
    const b = new RangeSetBuilder()
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to)
      const re = /\b[A-Za-z0-9_]+\b/g
      let m
      while ((m = re.exec(text))) {
        if (!this.words.has(m[0].toUpperCase())) continue
        // Skip matches inside comments (after ';' on the same line)
        const lineStart = text.lastIndexOf('\n', m.index) + 1
        if (text.slice(lineStart, m.index).includes(';')) continue
        b.add(from + m.index, from + m.index + m[0].length, watchMark)
      }
    }
    return b.finish()
  }
}, { decorations: v => v.decorations })

class ErrorGutterMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span')
    el.textContent = '✕'
    el.className = 'cm-error-gutter-marker'
    return el
  }
}
const errorGutterMarker = new ErrorGutterMarker()

const errorGutterState = StateField.define({
  create: () => new RangeSetBuilder().finish(),
  update(markers, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLineEff)) {
        if (!e.value) return new RangeSetBuilder().finish()
        try {
          const line = tr.newDoc.line(e.value)
          const b = new RangeSetBuilder()
          b.add(line.from, line.from, errorGutterMarker)
          return b.finish()
        } catch { return new RangeSetBuilder().finish() }
      }
    }
    return markers
  },
})
const errorGutterExt = gutter({
  class: 'cm-error-gutter',
  markers: view => view.state.field(errorGutterState),
  initialSpacer: () => errorGutterMarker,
})
const errorLineField  = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLineEff)) {
        if (e.value == null) return Decoration.none
        try {
          const line = tr.state.doc.line(e.value)
          return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)])
        } catch { return Decoration.none }
      }
    }
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

class ActiveLineGutterMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span')
    el.textContent = '▶'
    el.className = 'cm-active-line-gutter-marker'
    return el
  }
}
const activeLineGutterMarker = new ActiveLineGutterMarker()

const activeLineGutterState = StateField.define({
  create: () => new RangeSetBuilder().finish(),
  update(markers, tr) {
    for (const e of tr.effects) {
      if (e.is(setActiveLineEff)) {
        if (e.value == null) return new RangeSetBuilder().finish()
        try {
          const line = tr.newDoc.line(e.value)
          const b = new RangeSetBuilder()
          b.add(line.from, line.from, activeLineGutterMarker)
          return b.finish()
        } catch { return new RangeSetBuilder().finish() }
      }
    }
    return markers
  },
})
const activeLineGutterExt = gutter({
  class: 'cm-active-line-gutter',
  markers: view => view.state.field(activeLineGutterState),
  initialSpacer: () => activeLineGutterMarker,
})

const activeLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setActiveLineEff)) {
        if (e.value == null) return Decoration.none
        try {
          const line = tr.state.doc.line(e.value)
          return Decoration.set([Decoration.line({ class: 'cm-debug-active-line' }).range(line.from)])
        } catch { return Decoration.none }
      }
    }
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

class AddressMarker extends GutterMarker {
  constructor(addr, isBp) {
    super()
    this.addr = addr
    this.isBp = isBp
  }
  eq(other) { return this.addr === other.addr && this.isBp === other.isBp }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-addr-text'
    span.dataset.addr = this.addr
    if (this.isBp) span.classList.add('cm-addr-bp')
    span.textContent = (this.isBp ? '● ' : '') + hex4(this.addr)
    return span
  }
}
const addressGutterState = StateField.define({
  create: () => new RangeSetBuilder().finish(),
  update(markers, tr) {
    let next = markers.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setAddressesEff)) {
        const { addrs, bps } = e.value
        const b = new RangeSetBuilder()
        for (let i = 1; i <= tr.newDoc.lines; i++) {
          const addr = addrs.get(i)
          if (addr !== undefined) b.add(tr.newDoc.line(i).from, tr.newDoc.line(i).from, new AddressMarker(addr, bps?.has(addr)))
        }
        next = b.finish()
      }
    }
    return next
  }
})
const addressGutterExt = gutter({
  class: 'cm-address-gutter',
  markers: view => view.state.field(addressGutterState),
  initialSpacer: () => new AddressMarker(0x0000, true)
})

const flashLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(flashLineEff)) {
        if (e.value == null) return Decoration.none
        try {
          const line = tr.state.doc.lineAt(e.value.pos)
          return Decoration.set([Decoration.line({ class: 'cm-flash-line' }).range(line.from)])
        } catch { return Decoration.none }
      }
    }
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

function getInstWord(state, pos) {
  const line = state.doc.lineAt(pos)
  const text = line.text
  const lp = pos - line.from
  let s = lp, e = lp
  while (s > 0 && /[A-Za-z]/.test(text[s - 1])) s--
  while (e < text.length && /[A-Za-z]/.test(text[e])) e++
  return s < e ? text.slice(s, e).toUpperCase() : null
}

const hexHoverTooltip = hoverTooltip((view, pos, side) => {
  const line = view.state.doc.lineAt(pos)
  const text = line.text
  const lp = pos - line.from
  
  let s = lp, e = lp
  while (s > 0 && /[0-9A-Fa-fHh]/i.test(text[s - 1])) s--
  while (e < text.length && /[0-9A-Fa-fHh]/i.test(text[e])) e++
  if (s >= e) return null
  
  const word = text.slice(s, e)
  if (!/^[0-9A-Fa-f]+H$/i.test(word)) return null
  
  const val = parseInt(word.slice(0, -1), 16)
  if (isNaN(val)) return null

  return {
    pos: line.from + s,
    end: line.from + e,
    above: true,
    create(view) {
      const dom = document.createElement("div")
      const bits = val > 0xFF ? 16 : 8
      const binStr = val.toString(2).padStart(bits, '0').match(/.{4}/g).join(' ')
      dom.innerHTML = `<div style="padding: 4px 6px; font-family: var(--mono); font-size: 12px; line-height: 1.6;">
        <div style="display: flex; gap: 12px;">
          <span style="color: var(--text3)">DEC:</span>
          <span style="color: var(--accent); font-weight: 600;">${val}</span>
        </div>
        <div style="display: flex; gap: 12px;">
          <span style="color: var(--text3)">BIN:</span>
          <span style="color: var(--accent); font-weight: 600;">${binStr}</span>
        </div>
      </div>`
      return { dom }
    }
  }
})

const asmCompletionSource = (context) => {
  let word = context.matchBefore(/[A-Za-z]+/)
  if (!word) return null
  if (word.from === word.to && !context.explicit) return null

  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, word.from - line.from)

  // Don't complete when the letters follow digits — it's a hex suffix (e.g. 20H, 0FFH)
  if (/[0-9A-Fa-f]$/.test(before)) return null

  // Only complete at the mnemonic position: the word must be the first non-whitespace
  // token on the line (possibly after a label ending with ':')
  const stripped = before.replace(/^[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*[ \t]*:[ \t]*)?/, '')
  if (/\S/.test(stripped)) return null

  return {
    from: word.from,
    options: Object.entries(INST_HELP).map(([mnem, data]) => ({
      label: mnem,
      type: 'keyword',
      detail: data.bytes ? `${data.bytes}B` : '',
      info: data.brief
    }))
  }
}

export function AsmEditor({ value, onChange, onCursorInstruction, onInstructionDetail, errorLine, activeLine, gotoRef, onRunTo, onJumpMem, buildId, lineAddrRef, theme, watchedWords, bps, onToggleBp, onAddressClick, onFormat }) {
  const elRef      = useRef(null)
  const viewRef    = useRef(null)
  const syncing    = useRef(false)
  const cursorCb   = useRef(onCursorInstruction)
  const detailCb   = useRef(onInstructionDetail)
  const onRunToRef = useRef(onRunTo)
  const onJumpMemRef = useRef(onJumpMem)
  const onToggleBpRef = useRef(onToggleBp)
  const onAddressClickRef = useRef(onAddressClick)
  const themeConf  = useRef(new Compartment())
  const flashTimeoutRef = useRef(null)
  const [editorCtx, setEditorCtx] = useState(null)  // {addr, x, y}
  const onFormatRef = useRef(onFormat)
  useEffect(() => { cursorCb.current   = onCursorInstruction }, [onCursorInstruction])
  useEffect(() => { detailCb.current   = onInstructionDetail }, [onInstructionDetail])
  useEffect(() => { onRunToRef.current = onRunTo },             [onRunTo])
  useEffect(() => { onJumpMemRef.current = onJumpMem },         [onJumpMem])
  useEffect(() => { onToggleBpRef.current = onToggleBp },       [onToggleBp])
  useEffect(() => { onAddressClickRef.current = onAddressClick }, [onAddressClick])
  useEffect(() => { onFormatRef.current = onFormat }, [onFormat])

  useEffect(() => {
    if (!viewRef.current || !lineAddrRef?.current) return
    viewRef.current.dispatch({ effects: setAddressesEff.of({ addrs: lineAddrRef.current, bps }) })
  }, [buildId, lineAddrRef, bps])

  useEffect(() => {
    if (!viewRef.current || !watchedWords) return
    viewRef.current.dispatch({ effects: setWatchedWordsEff.of(watchedWords) })
  }, [watchedWords])

  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({ effects: setErrorLineEff.of(errorLine ?? null) })
  }, [errorLine])

  useEffect(() => {
    if (!viewRef.current) return
    const effects = [setActiveLineEff.of(activeLine ?? null)]
    if (activeLine != null) {
      try {
        const line = viewRef.current.state.doc.line(activeLine)
        effects.push(EditorView.scrollIntoView(line.from, { y: 'nearest', margin: 40 }))
      } catch {}
    }
    viewRef.current.dispatch({ effects })
  }, [activeLine])

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          lineNumbers(),
          addressGutterState,
          addressGutterExt,
          highlightActiveLine(),
          search({ top: true }),
          autocompletion({ override: [asmCompletionSource] }),
          keymap.of([
            ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, indentWithTab,
            { key: 'Shift-Alt-f', run: () => { onFormatRef.current?.(); return true; } }
          ]),
          themeConf.current.of(EditorView.theme({}, { dark: theme !== 'light' })),
          asm8085Lang.extension,
          asm8085Highlighting,
          errorLineField,
          errorGutterState,
          errorGutterExt,
          activeLineField,
          activeLineGutterState,
          activeLineGutterExt,
          flashLineField,
          hexHoverTooltip,
          watchHighlightPlugin,
          EditorView.theme({
            '&': { height:'100%', fontFamily:'"JetBrains Mono","Fira Code",monospace', fontSize:'15px', color:'var(--text)', backgroundColor:'transparent' },
            '.cm-scroller': { overflow:'auto' },
            '.cm-content': { padding:'8px 0', minHeight:'100%', caretColor:'var(--accent)' },
            '&.cm-focused .cm-cursor': { borderLeftColor:'var(--accent)' },
            '.cm-selectionBackground, ::selection': { backgroundColor:'var(--bg3)' },
            '.cm-activeLine, .cm-activeLineGutter': { backgroundColor:'var(--bg2)' },
            '.cm-gutters': { backgroundColor:'transparent', color:'var(--text3)', borderRight:'1px solid var(--border)' },
            '.cm-error-line': { background: 'rgba(255,60,60,0.18)' },
            '.cm-debug-active-line': { backgroundColor: 'var(--tint-accent-pc)' },
            '.cm-error-gutter': { width: '14px' },
            '.cm-error-gutter-marker': { color: 'var(--red)', fontSize: '10px', lineHeight: '1.6', cursor: 'default' },
            '.cm-active-line-gutter': { width: '14px' },
            '.cm-active-line-gutter-marker': { color: 'var(--accent)', fontSize: '10px', lineHeight: '1.6', cursor: 'default', paddingLeft: '2px' },
            '.cm-address-gutter': { width: '48px', paddingRight: '6px', textAlign: 'right', backgroundColor: 'transparent', cursor: 'pointer' },
            '.cm-lineNumbers .cm-gutterElement': { cursor: 'pointer' },
            '.cm-addr-text': { color: 'var(--text3)', fontSize: '11px', fontFamily: 'var(--mono)' },
            '.cm-addr-bp': { color: 'var(--red)', fontWeight: 700 },
            '.cm-watched-word': { backgroundColor: 'var(--tint-amber)', borderBottom: '1px solid var(--amber)', borderRadius: '2px' },
            '.cm-search': { background:'var(--bg2)', borderTop:'1px solid var(--border)', padding:'4px 8px', gap:'6px' },
            '.cm-search input': { background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:'3px', padding:'2px 6px' },
            '.cm-button': { background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:'3px', padding:'2px 8px', cursor:'pointer' },
            '.cm-tooltip': { background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '3px' },
            '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--bg3)', color: 'var(--accent)' },
          }),
          EditorView.updateListener.of(u => {
            if (u.docChanged && !syncing.current) onChange(u.state.doc.toString())
            if (u.selectionSet || u.docChanged) {
              const word = getInstWord(u.state, u.state.selection.main.head)
              cursorCb.current?.(word && INST_HELP[word] ? word : null)
            }
          }),
          EditorView.domEventHandlers({
            click(e, view) {
              if (!e.ctrlKey) return false
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos == null) return false
              const word = getInstWord(view.state, pos)
              if (word && INST_HELP[word]) { detailCb.current?.(word); return true }
              return false
            },
            contextmenu(e, view) {
              if (!onRunToRef.current || !lineAddrRef?.current) return false
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos == null) return false
              const lineNum = view.state.doc.lineAt(pos).number
              const addr = lineAddrRef.current.get(lineNum)
              if (addr === undefined) return false
              e.preventDefault()
              setEditorCtx({ addr, x: e.clientX, y: e.clientY })
              return true
            },
          }),
        ],
      }),
      parent: elRef.current,
    })
    viewRef.current = view
    if (gotoRef) gotoRef.current = (lineNum, labelName) => {
      try {
        let targetPos = null
        let headPos = null
        if (labelName) {
          const text = view.state.doc.toString()
          const escaped = labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const m = new RegExp(`(^|\\n)[\\t ]*(${escaped})[\\t ]*:`, 'im').exec(text)
          if (m) {
            targetPos = m.index + m[0].indexOf(m[2])
            headPos = targetPos + m[2].length
          }
        }
        if (targetPos === null) {
          const line = view.state.doc.line(lineNum)
          targetPos = line.from
          headPos = line.to
        }

        view.dispatch({ 
          selection: { anchor: targetPos, head: headPos }, 
          effects: [EditorView.scrollIntoView(targetPos, { y: 'center' }), flashLineEff.of({ pos: targetPos })] 
        })
        
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
        flashTimeoutRef.current = setTimeout(() => {
          if (viewRef.current) viewRef.current.dispatch({ effects: flashLineEff.of(null) })
        }, 1200)
      } catch {}
    }
    return () => view.destroy()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleGutterClick = (e) => {
      const view = viewRef.current
      if (!view) return

      // 1. Handle Address Gutter click
      if (e.target.closest('.cm-address-gutter')) {
        const el = e.target.closest('.cm-gutterElement')
        const addrText = el ? el.querySelector('.cm-addr-text') : e.target.closest('.cm-addr-text')
        if (addrText && addrText.dataset.addr != null) {
          e.preventDefault()
          e.stopPropagation()
          onAddressClickRef.current?.(parseInt(addrText.dataset.addr, 10))
        }
        return
      }

      // 2. Handle Line Number Gutter click (Breakpoint toggle)
      if (e.target.closest('.cm-lineNumbers')) {
        const rect = view.contentDOM.getBoundingClientRect()
        const pos = view.posAtCoords({ x: rect.left + 2, y: e.clientY })
        if (pos != null) {
          const lineNum = view.state.doc.lineAt(pos).number
          const addr = lineAddrRef.current?.get(lineNum)
          if (addr !== undefined) {
            e.preventDefault()
            e.stopPropagation()
            onToggleBpRef.current?.(addr)
          }
        }
      }
    }
    const el = elRef.current
    el?.addEventListener('mousedown', handleGutterClick)
    return () => el?.removeEventListener('mousedown', handleGutterClick)
  }, [lineAddrRef])

  // Sync value from outside (example load) without re-creating the editor
  const lastVal = useRef(value)
  useEffect(() => {
    if (!viewRef.current || value === lastVal.current) return
    lastVal.current = value
    const view = viewRef.current
    if (view.state.doc.toString() === value) return
    syncing.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: 0 },
      effects: EditorView.scrollIntoView(0),
    })
    syncing.current = false
  }, [value])

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: themeConf.current.reconfigure(EditorView.theme({}, { dark: theme !== 'light' }))
      })
    }
  }, [theme])

  useEffect(() => {
    if (!editorCtx) return
    const close = () => setEditorCtx(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [editorCtx])

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={elRef} className="editor-inner" />
      {editorCtx && (
        <div className="ctx-menu" style={{ left: editorCtx.x, top: editorCtx.y }}
          onMouseDown={e => e.stopPropagation()}>
          <button className="ctx-menu-item" onClick={() => { onAddressClickRef.current?.(editorCtx.addr); setEditorCtx(null) }}>
            📋 Jump to disassembly
          </button>
          <button className="ctx-menu-item" onClick={() => { onRunToRef.current?.(editorCtx.addr); setEditorCtx(null) }}>
            ▶ Run to {hex4(editorCtx.addr)}H
          </button>
          <button className="ctx-menu-item" onClick={() => { onJumpMemRef.current?.(editorCtx.addr); setEditorCtx(null) }}>
            💾 Jump to memory location
          </button>
        </div>
      )}
    </div>
  )
}