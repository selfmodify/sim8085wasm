import { useState, useEffect, useRef } from 'react';

const PANEL_HELP_TEXT = {
  'EDITOR': `• Write 8085 assembly — one instruction per line
• ORG <addr>  sets the load address
• KICKOFF <addr>  sets the entry point (where execution starts)
• Ctrl+click any mnemonic → full instruction docs
• Ctrl+F → find / replace bar
• Right-click an assembled line → run execution up to that line
• Directives: EQU, DB, DW, DS (highlighted purple)
• Pseudo-ops: KICKOFF, SETBYTE, SETWORD, ASSERT (highlighted red)`,

  'INSTRUCTION HELP': `• Shows docs for the instruction under your cursor
• Updates live as you type or move the cursor
• Displays: flags affected, byte size, T-state count, example
• Ctrl+click a mnemonic in the editor to pin its details`,

  'LED DISPLAY': `• Simulates the Intel SDK-85 7-segment LED display
• Drive it with CALL 5 system calls:
  · C=02H  write digit  (B=field, HL→data byte)
  · C=09H  scroll left, insert D as new right digit
  · C=0BH  scroll left with delay
  · C=03H  blank all fields
• Load the "LED Scroll" example to see it in action`,

  'DISASSEMBLY': `• Live disassembly of RAM starting from any address
• Type a hex address in the header + Enter to jump there
• PC↓ button  locks view to follow the program counter
• PC·  button  unlocks for free scrolling
• Each row shows the T-state cycle count on the right
• Click · in the gutter to set a breakpoint (●)
• Right-click a breakpoint to add a condition expression
• Breakpoint list below: jump to or remove any breakpoint
• Click a disasm row to jump the editor to that source line`,

  'AI ASSISTANT': `• Ask questions about your 8085 code
• Current register state + source are sent automatically
• Requires your own Anthropic API key
• Key is stored in this browser only — never sent elsewhere
• Click ⚙ to enter or change your API key`,

  'MEMORY': `• Hex dump of the full configured RAM
• Green cell = program counter (PC)
• Amber cell = stack pointer (SP)
• Blue cells = assembled program region
• Double-click a cell to edit its value
• Arrow keys + PgUp/PgDn to navigate
• Mouse wheel scrolls the view
• Drag the top handle to resize the panel (desktop only)

🔍 Search (hex byte):
• Enter a hex byte and press Search
• Matching cells highlight amber
• ◀ ▶ step through all hits

⊞ Fill range:
• Enter start address, end address, fill value
• Cells in range preview highlighted before filling
• Press Fill range to write the byte across the range

⬇ Export range:
• Download any selected memory range to a raw .bin file`,

  'MEMORY MAP': `• Visual representation of the 64KB address space
• Code (Blue): Assembled instructions
• Data (Green): Values injected via SETBYTE/SETWORD/DB/DW
• Stack (Amber): Region from SP to FFFFH
• Click any region to see its exact address bounds
• Bright green line indicates current Program Counter (PC)
• Drag the panel header to reorder it within the column`,

  'REGISTERS': `• Live 8085 register values (A, B, C, D, E, H, L, PC, SP)
• Click any value to edit it inline
• Right-click a value to copy it to the clipboard
• HEX / DEC / BIN toggle cycles the display format
• Green highlight = register changed since last step
• Bit toggles below A let you flip individual bits
• Drag the panel header to reorder it within the column`,

  'REGISTER PAIRS': `• BC, DE, HL shown as combined 16-bit pointers
• ADDR column: the 16-bit address held by the pair
• CONTENT column: the byte in RAM at that address
• Click ADDR to jump the memory view there
• Click CONTENT to edit the byte at that address
• Right-click either cell to copy its value
• HEX / DEC / BIN toggle applies to both columns
• Drag the panel header to reorder it within the column`,

  'FLAGS': `• Five 8085 status flags, updated after each instruction:
  · S   Sign flag — set if result is negative
  · Z   Zero flag — set if result is zero
  · AC  Auxiliary Carry — carry from bit 3 to 4 (BCD)
  · P   Parity — set if result has even number of 1-bits
  · CY  Carry — set if arithmetic produced a carry/borrow
• Drag the panel header to reorder it within the column`,

  'STACK': `• Shows memory at and above SP as a 16-bit value stack
• Top entry (current SP) is highlighted green
• PUSH rp: SP − 2, stores high byte then low byte
• POP rp:  loads low byte then high byte, SP + 2
• Stack grows downward — set SP before using PUSH
• Drag the panel header to reorder it within the column`,

  'CALL STACK': `• Shows the chain of subroutine calls (CALL and RST)
• Target address: where the call jumped to
• Call site: where the CALL instruction is located
• ret: where execution will resume after RET
• Click any address to jump the memory view there
• Drag the panel header to reorder it within the column`,

  'TRACE': `• Last 50 instructions executed, newest at bottom
• Each row: address · disassembled text · changed registers
• Changed register values are highlighted green
• Cleared on every Build
• Step through code to populate the trace
• Drag the panel header to reorder it within the column`,

  'WATCH': `• Monitor any register or memory location in real time
• Type a register name: A, B, BC, HL, SP, PC …
• Type a hex address: 0200H, 1000H …
• Press Enter or + to add it to the list
• Values update automatically after every step
• Click × on any row to remove it`,

  'CALCULATOR': `• Converts 16-bit values across four bases simultaneously
• BIN / OCT / DEC / HEX — type in any field
• All other fields update instantly
• Handy for working out immediate operands or addresses`,

  'I/O PORTS': `• OUTPUT section: ports written by OUT instructions
  · Values appear here after each OUT port, A
  · Cleared on every Build
• INPUT section: preset values for IN to read
  · Type a port number + value, press Enter
  · Presets survive a Build
  · Used by IN port, A when the program reads that port
• KEYBOARD section: character queue for syscall C=01H
  · Type text and press Enter (or +) to enqueue characters
  · Each CALL 5 with C=01H dequeues the next char (returns 00H when empty)
  · ✕ clears the entire queue
• Drag the panel header to reorder it within the column`,

  'CONSOLE': `• Treats bytes written by OUT to the configured port as ASCII text
• Default port is 01H — change it in the header field
• Printable characters (20H–7EH) are appended as-is
• 0AH (\\n) starts a new line; 0DH (\\r) is ignored; 08H (BS) deletes the last char
• ✕ button clears the display — also cleared on every Build
• Example: OUT 01H with A=48H prints 'H'`,

  'SYMBOLS': `• All labels defined in your source code
• Populated after a successful Build
• Shows label name and resolved hex address
• Click any row to jump the memory view to that address`,

  'INTERRUPTS': `• Controls the 8085 interrupt lines in real time
• IFF — Interrupt Flip-Flop: set by EI, cleared by DI or when an interrupt is taken
• TRAP — non-maskable, fires once per click regardless of IFF or mask
• RST 7.5 — edge-triggered latch: FIRE sets the latch; it clears when serviced or via SIM b4=1
• RST 6.5 / RST 5.5 — level-triggered: ON holds the line high until you click OFF
• INTR — level-triggered; select which RST n vector (0–7) appears on the data bus
• Mask badges appear when the program has masked a line via SIM
• Write ISRs at the vector addresses (e.g. ORG 003CH for RST 7.5) and end them with EI + RET
• Drag the panel header to reorder it within the column`,

  '8255 PPI': `• Programmable Peripheral Interface (Ports 00H–03H)
• Control Word (03H) configures ports A, B, and C as Input or Output
• Mode 0 is supported (basic I/O)
• Output ports display the bits sent via OUT
• Input ports provide clickable bits to toggle state for IN`,

  '8253 PIT': `• Programmable Interval Timer (Ports 10H–13H)
• Control Word (13H) selects counter and mode
• Counters 0, 1, and 2 are mapped to 10H, 11H, and 12H
• Currently serves as a visual decoder for the control word and counter values`,

  'AUDIO OUTPUT': `• Web Audio API synthesizer mapped to PORT 40H
• OUT 40H with a value > 0 generates a square wave tone
• OUT 40H with 0 mutes the audio
• Must click the ON button first to enable audio output
• Use Fast speed (not Warp) for best playback timing
• Drag the panel header to reorder it within the column`,

  'BREADBOARD': `In real physical 8085 microcomputer trainer kits, a 7-segment LED display cannot be connected directly to the CPU's data bus. Instead, it requires an interface chip to latch the data, hold the state, and drive the electrical current to light up the segments.

The 8255 Programmable Peripheral Interface (PPI) is the standard chip used for this purpose. It provides 24 general-purpose I/O pins (grouped into Ports A, B, and C). In a typical hardware setup:

• One port of the 8255 is wired to the LED segments (a-g, and the decimal point) to control what is displayed.
• Another port is wired to the common cathodes/anodes of the digits to control which digit is currently active (known as multiplexing).

The wires you see running from the 8255 panel to the LED display panel in the Hardware view are a visual representation of this physical hardware architecture. They illustrate that the 8255 PPI acts as the necessary bridge between the 8085 CPU and the raw LED hardware.

Similarly, the wires connecting the 8253 PIT to the 8255 represent the timer/counter outputs being fed back into the general-purpose I/O ports, which is another common educational wiring exercise!`,
}

export function PanelHelp({ panel, wide }) {
  const [popupPos, setPopupPos] = useState(null)  // null = hidden, {top,bottom,left} = visible
  const wrapRef = useRef(null)
  const text = PANEL_HELP_TEXT[panel]
  const show = popupPos !== null

  useEffect(() => {
    if (!show) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setPopupPos(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [show])
  useEffect(() => {
    if (!show) return
    const h = e => { if (e.key === 'Escape') setPopupPos(null) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [show])

  if (!text) return null

  const toggle = () => {
    if (show) { setPopupPos(null); return }
    if (!wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const popupW = wide ? 420 : 300
    const left = Math.max(8, Math.min(rect.right - popupW, window.innerWidth - popupW - 8))
    const spaceBelow = window.innerHeight - rect.bottom
    if (spaceBelow < 280) {
      setPopupPos({ bottom: window.innerHeight - rect.top + 5, top: 'auto', left })
    } else {
      setPopupPos({ top: rect.bottom + 5, bottom: 'auto', left })
    }
  }

  return (
    <div className="panel-help-wrap" ref={wrapRef}>
      <button className="panel-help-btn" onClick={toggle} title="Panel help">?</button>
      {show && (
        <div className={`panel-help-popup${wide ? ' panel-help-popup-wide' : ''}`}
          style={{ top: popupPos.top, bottom: popupPos.bottom, left: popupPos.left }}>
          {text}
        </div>
      )}
    </div>
  )
}