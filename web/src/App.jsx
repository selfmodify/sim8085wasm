import { useState, useEffect, useRef, useMemo } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, hoverTooltip } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import * as sim from './sim8085Bridge.js'
import './App.css'

// ── Example programs ────────────────────────────────────────────────────
const EXAMPLES = {
  'Counter': `; Simple A register counter
    org 100
    kickoff 100
    mvi a,0
    mvi b,0
loop:
    inr a
    inr b
    jnz loop
    hlt`,

  'Bubble Sort': `; Bubble sort — sorts 10 values
    setbyte 251,34
    setbyte 252,30
    setbyte 253,26
    setbyte 254,23
    setbyte 255,20
    setbyte 256,17
    setbyte 257,14
    setbyte 258,10
    setbyte 259,7
    setbyte 25a,3

    org 100
    kickoff 100
    mvi  b,9
loop2: lxi  h,251
    mov  c,b
loop1: mov  a,m
    inx  h
    cmp  m
    jc   next
    mov  d,m
    mov  m,a
    dcx  h
    mov  m,d
    inx  h
next: dcr  c
    jnz  loop1
    dcr  b
    jnz  loop2
    hlt`,

  'Fibonacci': `; Fibonacci sequence stored from 200H
    org 100
    kickoff 100
    lxi h,200
    mvi a,0
    mov m,a
    inx h
    mvi a,1
    mov m,a
    inx h
    mvi b,0eH
fib:
    dcx h
    mov a,m
    inx h
    add m
    inx h
    mov m,a
    dcr b
    jnz fib
    hlt`,

  'LED Scroll': `; Scroll the LED display (watch the LED panel!)
    org 100
    kickoff 100
    setbyte 511,0
    setbyte 512,1
    setbyte 513,2
    setbyte 514,3
    setbyte 515,4
    setbyte 516,5
    setbyte 517,6
    setbyte 518,7
    lxi sp,200
again:
    lxi h,511
    mvi b,8
loop:
    mvi  c,0bH
    mov d,m
    call 5
    mvi a,9
    push h
    lxi h,55H
    call 5
    pop h
    inx h
    dcr b
    jnz loop
    jmp again
    hlt`,

  'Checksum': `; Compute XOR checksum of memory block
    org 100
    kickoff 100
    setbyte 200,0aH
    setbyte 201,1bH
    setbyte 202,2cH
    setbyte 203,3dH
    setbyte 204,4eH
    lxi h,200
    mvi b,5
    mvi a,0
xloop:
    xra m
    inx h
    dcr b
    jnz xloop
    sta 300
    hlt`,
}

// ── Helpers ─────────────────────────────────────────────────────────────
const hex2 = n => (n >>> 0 & 0xFF).toString(16).toUpperCase().padStart(2,'0')
const hex4 = n => (n >>> 0 & 0xFFFF).toString(16).toUpperCase().padStart(4,'0')

// ── 8085 instruction reference ───────────────────────────────────────────
const INST_HELP = {
  // Data transfer
  MOV:  { brief:'Copy register/memory to register/memory', flags:'—', bytes:1, cycles:'4 / 7 (M)', desc:'MOV dst, src copies 8-bit content of src into dst. Either operand can be M (memory at HL).', ex:'MOV A, B      ; A ← B\nMOV M, C      ; mem[HL] ← C' },
  MVI:  { brief:'Load immediate byte into register/memory', flags:'—', bytes:2, cycles:'7 / 10 (M)', desc:'MVI dst, imm8 loads an 8-bit constant. dst can be A B C D E H L or M (memory at HL).', ex:'MVI A, 42H    ; A ← 42H\nMVI M, 00H    ; mem[HL] ← 0' },
  LDA:  { brief:'Load A from 16-bit memory address', flags:'—', bytes:3, cycles:'13', desc:'Loads the byte stored at the given 16-bit address into the accumulator.', ex:'LDA 2050H     ; A ← mem[2050H]' },
  STA:  { brief:'Store A to 16-bit memory address', flags:'—', bytes:3, cycles:'13', desc:'Stores the accumulator into the byte at the given 16-bit address.', ex:'STA 2050H     ; mem[2050H] ← A' },
  LHLD: { brief:'Load HL from memory (16-bit)', flags:'—', bytes:3, cycles:'16', desc:'Loads L from addr and H from addr+1.', ex:'LHLD 2040H    ; L←mem[2040H], H←mem[2041H]' },
  SHLD: { brief:'Store HL to memory (16-bit)', flags:'—', bytes:3, cycles:'16', desc:'Stores L at addr and H at addr+1.', ex:'SHLD 2040H    ; mem[2040H]←L, mem[2041H]←H' },
  LDAX: { brief:'Load A from address in BC or DE', flags:'—', bytes:1, cycles:'7', desc:'Loads A from the address held in BC (LDAX B) or DE (LDAX D).', ex:'LDAX D        ; A ← mem[DE]' },
  STAX: { brief:'Store A to address in BC or DE', flags:'—', bytes:1, cycles:'7', desc:'Stores A at the address held in BC (STAX B) or DE (STAX D).', ex:'STAX B        ; mem[BC] ← A' },
  XCHG: { brief:'Exchange HL and DE registers', flags:'—', bytes:1, cycles:'4', desc:'Swaps the full contents of the HL and DE register pairs.', ex:'XCHG          ; HL ↔ DE' },
  LXI:  { brief:'Load register pair with 16-bit immediate', flags:'—', bytes:3, cycles:'10', desc:'Loads a 16-bit constant into BC (B), DE (D), HL (H), or SP.', ex:'LXI H, 1000H  ; HL ← 1000H' },
  PUSH: { brief:'Push register pair onto stack', flags:'—', bytes:1, cycles:'12', desc:'SP decrements by 2; high byte pushed first, then low byte. PUSH PSW pushes A and flags.', ex:'PUSH B        ; push BC\nPUSH PSW      ; push A + flags' },
  POP:  { brief:'Pop register pair from stack', flags:'— (PSW restores flags)', bytes:1, cycles:'10', desc:'Pops 2 bytes from stack into the pair. POP PSW restores A and all flags.', ex:'POP H         ; pop into HL' },
  XTHL: { brief:'Exchange HL with top of stack', flags:'—', bytes:1, cycles:'16', desc:'Swaps H with (SP+1) and L with (SP) without changing SP.', ex:'XTHL' },
  SPHL: { brief:'Copy HL into SP', flags:'—', bytes:1, cycles:'6', desc:'Loads the stack pointer with the content of HL.', ex:'SPHL          ; SP ← HL' },
  PCHL: { brief:'Jump indirect through HL', flags:'—', bytes:1, cycles:'6', desc:'Loads the program counter with HL — an indirect/computed jump.', ex:'PCHL          ; PC ← HL' },
  // Arithmetic
  ADD:  { brief:'Add register/memory to A', flags:'S Z AC P CY', bytes:1, cycles:'4 / 7 (M)', desc:'A ← A + src. Sets all arithmetic flags.', ex:'ADD B         ; A ← A + B\nADD M         ; A ← A + mem[HL]' },
  ADC:  { brief:'Add register/memory to A with carry', flags:'S Z AC P CY', bytes:1, cycles:'4 / 7 (M)', desc:'A ← A + src + CY. Used for multi-byte addition.', ex:'ADC C         ; A ← A + C + CY' },
  ADI:  { brief:'Add immediate byte to A', flags:'S Z AC P CY', bytes:2, cycles:'7', desc:'A ← A + imm8.', ex:'ADI 05H       ; A ← A + 5' },
  ACI:  { brief:'Add immediate to A with carry', flags:'S Z AC P CY', bytes:2, cycles:'7', desc:'A ← A + imm8 + CY.', ex:'ACI 02H       ; A ← A + 2 + CY' },
  DAD:  { brief:'Add register pair to HL', flags:'CY only', bytes:1, cycles:'10', desc:'HL ← HL + rp. Only CY is affected; other flags unchanged.', ex:'DAD B         ; HL ← HL + BC\nDAD SP        ; HL ← HL + SP' },
  SUB:  { brief:'Subtract register/memory from A', flags:'S Z AC P CY', bytes:1, cycles:'4 / 7 (M)', desc:'A ← A − src. CY=1 indicates a borrow.', ex:'SUB D         ; A ← A − D' },
  SBB:  { brief:'Subtract register/memory from A with borrow', flags:'S Z AC P CY', bytes:1, cycles:'4 / 7 (M)', desc:'A ← A − src − CY. Used for multi-byte subtraction.', ex:'SBB E         ; A ← A − E − CY' },
  SUI:  { brief:'Subtract immediate from A', flags:'S Z AC P CY', bytes:2, cycles:'7', desc:'A ← A − imm8.', ex:'SUI 10H       ; A ← A − 16' },
  SBI:  { brief:'Subtract immediate from A with borrow', flags:'S Z AC P CY', bytes:2, cycles:'7', desc:'A ← A − imm8 − CY.', ex:'SBI 05H' },
  INR:  { brief:'Increment register/memory by 1', flags:'S Z AC P (not CY)', bytes:1, cycles:'4 / 10 (M)', desc:'dst ← dst + 1. Does NOT affect the carry flag.', ex:'INR A         ; A ← A + 1\nINR M         ; mem[HL] ← mem[HL] + 1' },
  DCR:  { brief:'Decrement register/memory by 1', flags:'S Z AC P (not CY)', bytes:1, cycles:'4 / 10 (M)', desc:'dst ← dst − 1. Does NOT affect the carry flag.', ex:'DCR B         ; B ← B − 1' },
  INX:  { brief:'Increment register pair by 1', flags:'—', bytes:1, cycles:'6', desc:'rp ← rp + 1. No flags are affected (including CY).', ex:'INX H         ; HL ← HL + 1' },
  DCX:  { brief:'Decrement register pair by 1', flags:'—', bytes:1, cycles:'6', desc:'rp ← rp − 1. No flags are affected.', ex:'DCX D         ; DE ← DE − 1' },
  DAA:  { brief:'Decimal adjust accumulator after BCD operation', flags:'S Z AC P CY', bytes:1, cycles:'4', desc:'Corrects A after BCD addition/subtraction so both nibbles hold valid BCD digits (0–9). Must follow ADD/ADC/SUB/SBB on BCD data.', ex:'ADD B\nDAA           ; adjust for BCD' },
  // Logic
  ANA:  { brief:'AND register/memory with A', flags:'S Z P  AC=1  CY=0', bytes:1, cycles:'4 / 7 (M)', desc:'A ← A & src. Resets CY, sets AC.', ex:'ANA B         ; A ← A & B' },
  ANI:  { brief:'AND immediate with A', flags:'S Z P  AC=1  CY=0', bytes:2, cycles:'7', desc:'A ← A & imm8. Common use: masking bits.', ex:'ANI 0FH       ; keep lower nibble' },
  ORA:  { brief:'OR register/memory with A', flags:'S Z P  AC=0  CY=0', bytes:1, cycles:'4 / 7 (M)', desc:'A ← A | src. Resets CY and AC.', ex:'ORA C         ; A ← A | C' },
  ORI:  { brief:'OR immediate with A', flags:'S Z P  AC=0  CY=0', bytes:2, cycles:'7', desc:'A ← A | imm8. Common use: setting specific bits.', ex:'ORI 80H       ; set bit 7' },
  XRA:  { brief:'XOR register/memory with A', flags:'S Z P  AC=0  CY=0', bytes:1, cycles:'4 / 7 (M)', desc:'A ← A ⊕ src. XRA A is the standard way to clear A quickly.', ex:'XRA A         ; A ← 0, clears flags' },
  XRI:  { brief:'XOR immediate with A', flags:'S Z P  AC=0  CY=0', bytes:2, cycles:'7', desc:'A ← A ⊕ imm8. Common use: toggling bits.', ex:'XRI 0FFH      ; invert all bits' },
  CMA:  { brief:'Complement accumulator (bitwise NOT)', flags:'—', bytes:1, cycles:'4', desc:'A ← ~A. Inverts every bit; no flags changed.', ex:'CMA           ; A ← ~A' },
  CMC:  { brief:'Complement carry flag', flags:'CY', bytes:1, cycles:'4', desc:'CY ← ~CY. Other flags unaffected.', ex:'CMC' },
  STC:  { brief:'Set carry flag to 1', flags:'CY=1', bytes:1, cycles:'4', desc:'Sets CY to 1. Other flags unaffected.', ex:'STC' },
  CMP:  { brief:'Compare register/memory with A (sets flags only)', flags:'S Z AC P CY', bytes:1, cycles:'4 / 7 (M)', desc:'Performs A − src and sets flags without modifying A. ZF=1 means equal; CY=1 means A < src.', ex:'CMP B         ; set flags for A vs B\nJZ equal      ; jump if equal' },
  CPI:  { brief:'Compare immediate with A (sets flags only)', flags:'S Z AC P CY', bytes:2, cycles:'7', desc:'Performs A − imm8 and sets flags without changing A.', ex:'CPI 0AH       ; compare A with 10' },
  RLC:  { brief:'Rotate A left, MSB goes to CY and bit 0', flags:'CY', bytes:1, cycles:'4', desc:'Bit 7 is copied to CY and also wraps into bit 0. Other flags unchanged.', ex:'RLC           ; A: b7→CY, b7→b0' },
  RRC:  { brief:'Rotate A right, LSB goes to CY and bit 7', flags:'CY', bytes:1, cycles:'4', desc:'Bit 0 is copied to CY and also wraps into bit 7. Other flags unchanged.', ex:'RRC           ; A: b0→CY, b0→b7' },
  RAL:  { brief:'Rotate A left through carry (9-bit)', flags:'CY', bytes:1, cycles:'4', desc:'Bit 7 → CY; old CY → bit 0. All 9 bits (A + CY) rotate together.', ex:'RAL           ; CY←b7, b0←old CY' },
  RAR:  { brief:'Rotate A right through carry (9-bit)', flags:'CY', bytes:1, cycles:'4', desc:'Bit 0 → CY; old CY → bit 7. All 9 bits (A + CY) rotate together.', ex:'RAR           ; CY←b0, b7←old CY' },
  // Branch
  JMP:  { brief:'Unconditional jump to address', flags:'—', bytes:3, cycles:'10', desc:'PC ← addr. Program continues at the specified address.', ex:'JMP 0100H' },
  JC:   { brief:'Jump if carry set (CY=1)', flags:'—', bytes:3, cycles:'10 / 7', desc:'PC ← addr only if CY=1, otherwise executes next instruction.', ex:'JC carry_err' },
  JNC:  { brief:'Jump if no carry (CY=0)', flags:'—', bytes:3, cycles:'10 / 7', desc:'PC ← addr only if CY=0.', ex:'JNC continue' },
  JZ:   { brief:'Jump if zero flag set (ZF=1)', flags:'—', bytes:3, cycles:'10 / 7', desc:'PC ← addr only if ZF=1 (last result was zero).', ex:'JZ done' },
  JNZ:  { brief:'Jump if not zero (ZF=0)', flags:'—', bytes:3, cycles:'10 / 7', desc:'PC ← addr only if ZF=0. Classic loop instruction.', ex:'DCR B\nJNZ loop' },
  JP:   { brief:'Jump if positive (SF=0)', flags:'—', bytes:3, cycles:'10 / 7', desc:'PC ← addr only if SF=0 (result was non-negative).', ex:'JP positive' },
  JM:   { brief:'Jump if minus (SF=1)', flags:'—', bytes:3, cycles:'10 / 7', desc:'PC ← addr only if SF=1 (result was negative / bit 7 set).', ex:'JM negative' },
  JPE:  { brief:'Jump if parity even (PF=1)', flags:'—', bytes:3, cycles:'10 / 7', desc:'PC ← addr only if PF=1 (even number of 1-bits in result).', ex:'JPE even' },
  JPO:  { brief:'Jump if parity odd (PF=0)', flags:'—', bytes:3, cycles:'10 / 7', desc:'PC ← addr only if PF=0.', ex:'JPO odd' },
  CALL: { brief:'Unconditional subroutine call', flags:'—', bytes:3, cycles:'18', desc:'Pushes the return address (PC+3) onto the stack, then jumps to addr.', ex:'CALL delay    ; call subroutine' },
  CC:   { brief:'Call subroutine if carry (CY=1)', flags:'—', bytes:3, cycles:'18 / 9', desc:'Conditional call — pushes return addr and jumps only if CY=1.', ex:'CC overflow' },
  CNC:  { brief:'Call subroutine if no carry (CY=0)', flags:'—', bytes:3, cycles:'18 / 9', desc:'Conditional call if CY=0.', ex:'CNC proceed' },
  CZ:   { brief:'Call subroutine if zero (ZF=1)', flags:'—', bytes:3, cycles:'18 / 9', desc:'Conditional call if ZF=1.', ex:'CZ zero_case' },
  CNZ:  { brief:'Call subroutine if not zero (ZF=0)', flags:'—', bytes:3, cycles:'18 / 9', desc:'Conditional call if ZF=0.', ex:'CNZ loop' },
  CP:   { brief:'Call subroutine if positive (SF=0)', flags:'—', bytes:3, cycles:'18 / 9', desc:'Conditional call if SF=0.', ex:'CP pos_handler' },
  CM:   { brief:'Call subroutine if minus (SF=1)', flags:'—', bytes:3, cycles:'18 / 9', desc:'Conditional call if SF=1.', ex:'CM neg_handler' },
  CPE:  { brief:'Call subroutine if parity even (PF=1)', flags:'—', bytes:3, cycles:'18 / 9', desc:'Conditional call if PF=1.', ex:'CPE even_handler' },
  CPO:  { brief:'Call subroutine if parity odd (PF=0)', flags:'—', bytes:3, cycles:'18 / 9', desc:'Conditional call if PF=0.', ex:'CPO odd_handler' },
  RET:  { brief:'Return from subroutine', flags:'—', bytes:1, cycles:'10', desc:'Pops the return address from the stack back into PC.', ex:'RET' },
  RC:   { brief:'Return if carry (CY=1)', flags:'—', bytes:1, cycles:'12 / 6', desc:'Conditional return — pops PC only if CY=1.', ex:'RC' },
  RNC:  { brief:'Return if no carry (CY=0)', flags:'—', bytes:1, cycles:'12 / 6', desc:'Conditional return if CY=0.', ex:'RNC' },
  RZ:   { brief:'Return if zero (ZF=1)', flags:'—', bytes:1, cycles:'12 / 6', desc:'Conditional return if ZF=1.', ex:'RZ' },
  RNZ:  { brief:'Return if not zero (ZF=0)', flags:'—', bytes:1, cycles:'12 / 6', desc:'Conditional return if ZF=0.', ex:'RNZ' },
  RP:   { brief:'Return if positive (SF=0)', flags:'—', bytes:1, cycles:'12 / 6', desc:'Conditional return if SF=0.', ex:'RP' },
  RM:   { brief:'Return if minus (SF=1)', flags:'—', bytes:1, cycles:'12 / 6', desc:'Conditional return if SF=1.', ex:'RM' },
  RPE:  { brief:'Return if parity even (PF=1)', flags:'—', bytes:1, cycles:'12 / 6', desc:'Conditional return if PF=1.', ex:'RPE' },
  RPO:  { brief:'Return if parity odd (PF=0)', flags:'—', bytes:1, cycles:'12 / 6', desc:'Conditional return if PF=0.', ex:'RPO' },
  RST:  { brief:'Software restart (interrupt vector call)', flags:'—', bytes:1, cycles:'12', desc:'RST n pushes PC and jumps to address n×8 (0H–38H). Used for interrupt service routines.', ex:'RST 7         ; push PC, jump to 0038H' },
  // I/O and control
  IN:   { brief:'Read byte from I/O port into A', flags:'—', bytes:2, cycles:'10', desc:'A ← port(imm8). Reads from the given 8-bit I/O port number.', ex:'IN 01H        ; A ← port 1' },
  OUT:  { brief:'Write A to I/O port', flags:'—', bytes:2, cycles:'10', desc:'port(imm8) ← A. Writes the accumulator to the given 8-bit I/O port.', ex:'OUT 01H       ; port 1 ← A' },
  HLT:  { brief:'Halt the processor', flags:'—', bytes:1, cycles:'5', desc:'Stops execution. The CPU enters a halted state until an interrupt or hardware reset occurs.', ex:'HLT' },
  NOP:  { brief:'No operation — does nothing for 4 cycles', flags:'—', bytes:1, cycles:'4', desc:'Advances PC by 1 and burns 4 clock cycles. Used for timing delays and code alignment.', ex:'NOP' },
  EI:   { brief:'Enable maskable interrupts', flags:'—', bytes:1, cycles:'4', desc:'Sets the interrupt-enable flip-flop (INTE). Interrupts are acknowledged after the next instruction completes.', ex:'EI\nRET           ; enable before return' },
  DI:   { brief:'Disable maskable interrupts', flags:'—', bytes:1, cycles:'4', desc:'Resets INTE so maskable interrupts (INTR, RST5.5, RST6.5, RST7.5) are ignored.', ex:'DI' },
  RIM:  { brief:'Read interrupt mask into A', flags:'—', bytes:1, cycles:'4', desc:'Loads A with interrupt mask bits, pending interrupt flags, and the SID (serial input data) bit.', ex:'RIM           ; read interrupt status' },
  SIM:  { brief:'Set interrupt mask from A', flags:'—', bytes:1, cycles:'4', desc:'Uses A to set RST5.5/RST6.5/RST7.5 masks and write the SOD (serial output data) bit.', ex:'SIM           ; write interrupt mask' },
  ORG:  { brief:'Set assembly origin address (assembler directive)', flags:'—', bytes:0, cycles:'—', desc:'Tells the assembler to place subsequent code/data at the given address. Not a CPU instruction.', ex:'ORG 0100H' },
}

function getInstWord(state, pos) {
  const line = state.doc.lineAt(pos)
  const text = line.text
  const lp = pos - line.from
  let s = lp, e = lp
  while (s > 0 && /[A-Za-z]/.test(text[s - 1])) s--
  while (e < text.length && /[A-Za-z]/.test(text[e])) e++
  return s < e ? text.slice(s, e).toUpperCase() : null
}

// ── 7-segment LED digit ──────────────────────────────────────────────────
function SevenSeg({ value }) {
  const ON = '#FF2200', OFF = 'rgba(255,34,0,0.15)'
  const segs = [
    { id:'a', d:'M3 1 L11 1 L10 3 L4 3 Z', bit:1 },
    { id:'b', d:'M11 2 L13 4 L12 10 L10 8 L10 3 Z', bit:2 },
    { id:'c', d:'M12 10 L13 18 L11 20 L9 18 L10 12 Z', bit:4 },
    { id:'d', d:'M3 19 L11 19 L10 21 L4 21 Z', bit:8 },
    { id:'e', d:'M1 10 L3 8 L4 12 L3 18 L1 18 Z', bit:16 },
    { id:'f', d:'M1 2 L4 2 L4 8 L2 10 L1 8 Z', bit:32 },
    { id:'g', d:'M3 9 L5 8 L9 8 L11 9 L9 10 L5 10 Z', bit:64 },
    { id:'dot', d:'M14 19 L16 19 L16 21 L14 21 Z', bit:128 },
  ]
  return (
    <svg width="22" height="32" viewBox="0 0 17 23">
      {segs.map(s => <path key={s.id} d={s.d} fill={value & s.bit ? ON : OFF} />)}
    </svg>
  )
}

// ── CodeMirror editor ────────────────────────────────────────────────────
function AsmEditor({ value, onChange, onCursorInstruction, onInstructionDetail }) {
  const elRef    = useRef(null)
  const viewRef  = useRef(null)
  const syncing  = useRef(false)
  const cursorCb = useRef(onCursorInstruction)
  const detailCb = useRef(onInstructionDetail)
  useEffect(() => { cursorCb.current = onCursorInstruction }, [onCursorInstruction])
  useEffect(() => { detailCb.current = onInstructionDetail }, [onInstructionDetail])

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          lineNumbers(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          oneDark,
          EditorView.theme({
            '&': { height:'100%', fontFamily:'"JetBrains Mono","Fira Code",monospace', fontSize:'15px' },
            '.cm-scroller': { overflow:'auto' },
            '.cm-content': { padding:'8px 0', minHeight:'100%' },
          }),
          EditorView.updateListener.of(u => {
            if (u.docChanged && !syncing.current) onChange(u.state.doc.toString())
            if (u.selectionSet || u.docChanged) {
              const word = getInstWord(u.state, u.state.selection.main.head)
              cursorCb.current?.(word && INST_HELP[word] ? word : null)
            }
          }),
          hoverTooltip((view, pos) => {
            const word = getInstWord(view.state, pos)
            if (!word || !INST_HELP[word]) return null
            const inst = INST_HELP[word]
            return {
              pos, above: true,
              create() {
                const dom = document.createElement('div')
                dom.className = 'asm-tooltip'
                dom.innerHTML =
                  `<div class="asm-tt-name">${word}</div>` +
                  `<div class="asm-tt-brief">${inst.brief}</div>` +
                  `<div class="asm-tt-meta">Flags: ${inst.flags} &nbsp;·&nbsp; ${inst.bytes}B &nbsp;·&nbsp; ${inst.cycles} cycles</div>` +
                  `<div class="asm-tt-tip">Ctrl+click for full details</div>`
                return { dom }
              }
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
            }
          }),
        ],
      }),
      parent: elRef.current,
    })
    viewRef.current = view
    return () => view.destroy()
  }, [])

  // Sync value from outside (example load) without re-creating the editor
  const lastVal = useRef(value)
  useEffect(() => {
    if (!viewRef.current || value === lastVal.current) return
    lastVal.current = value
    const view = viewRef.current
    if (view.state.doc.toString() === value) return
    syncing.current = true
    view.dispatch({ changes: { from:0, to:view.state.doc.length, insert:value } })
    syncing.current = false
  }, [value])

  return <div ref={elRef} className="editor-inner" />
}

// ── Register panel ───────────────────────────────────────────────────────
function RegPanel({ regs, prev }) {
  function Row({ name, val, prevVal }) {
    return (
      <div className={`reg-row${prevVal !== undefined && val !== prevVal ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{hex2(val)}</span>
        <span className="reg-dec">{val}</span>
      </div>
    )
  }
  function Row16({ name, val, prevVal }) {
    return (
      <div className={`reg-row wide${prevVal !== undefined && val !== prevVal ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{hex4(val)}</span>
        <span className="reg-dec">{val}</span>
      </div>
    )
  }
  const p = prev || {}
  return (
    <div className="panel reg-panel">
      <div className="panel-hd">REGISTERS</div>
      <Row name="A"  val={regs.a}  prevVal={p.a} />
      <Row name="B"  val={regs.b}  prevVal={p.b} />
      <Row name="C"  val={regs.c}  prevVal={p.c} />
      <Row name="D"  val={regs.d}  prevVal={p.d} />
      <Row name="E"  val={regs.e}  prevVal={p.e} />
      <Row name="H"  val={regs.h}  prevVal={p.h} />
      <Row name="L"  val={regs.l}  prevVal={p.l} />
      <div className="reg-sep" />
      <Row16 name="PC" val={regs.pc} prevVal={p.pc} />
      <Row16 name="SP" val={regs.sp} prevVal={p.sp} />
    </div>
  )
}

// ── Flags panel ──────────────────────────────────────────────────────────
function FlagPanel({ regs }) {
  const FLAGS = [
    { label:'S',  key:'flagS',  title:'Sign — result was negative' },
    { label:'Z',  key:'flagZ',  title:'Zero — result was zero' },
    { label:'AC', key:'flagAC', title:'Auxiliary Carry — carry from bit 3' },
    { label:'P',  key:'flagP',  title:'Parity — even number of 1-bits' },
    { label:'CY', key:'flagCY', title:'Carry — result overflowed' },
  ]
  return (
    <div className="panel flag-panel">
      <div className="panel-hd">FLAGS</div>
      <div className="flags-row">
        {FLAGS.map(f => (
          <div key={f.key} className={`flag${regs[f.key] ? ' flag-on' : ''}`} title={f.title}>
            <div className="flag-lbl">{f.label}</div>
            <div className="flag-val">{regs[f.key]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Disassembly panel ────────────────────────────────────────────────────
function DisasmPanel({ regs, breakpoints, onToggleBp, buildId }) {
  const [viewStart, setViewStart] = useState(() => regs.pc)

  const lines = useMemo(() => {
    const out = []
    let addr = viewStart
    for (let i = 0; i < 20 && addr < 0x4000; i++) {
      const d = sim.simDisassemble(addr)
      out.push({ addr, ...d })
      addr += Math.max(1, d.len)
    }
    return out
  }, [viewStart, buildId])

  // After a build snap the view to the new entry point
  useEffect(() => { setViewStart(regs.pc) }, [buildId]) // eslint-disable-line react-hooks/exhaustive-deps

  // While stepping/running: scroll only when PC leaves the visible range
  useEffect(() => {
    if (!lines.length) return
    const lo = lines[0].addr
    const hi = lines[lines.length - 1].addr
    if (regs.pc < lo || regs.pc > hi) setViewStart(regs.pc)
  }, [regs.pc, lines])

  return (
    <div className="panel disasm-panel">
      <div className="panel-hd">DISASSEMBLY</div>
      <div className="disasm-list">
        {lines.map(row => {
          const cur = row.addr === regs.pc
          const bp  = breakpoints.has(row.addr)
          return (
            <div
              key={row.addr}
              className={`disasm-row${cur ? ' cur' : ''}${bp ? ' bp' : ''}`}
              onClick={() => onToggleBp(row.addr)}
              title="Click to toggle breakpoint"
            >
              <span className="disasm-bp">{bp ? '●' : '·'}</span>
              <span className="disasm-text">{row.text}</span>
              {cur && <span className="disasm-pc-arrow">◀</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Memory dump panel ────────────────────────────────────────────────────
function MemPanel({ memStart, onJump, regs, buildId }) {
  const [mem, setMem] = useState(new Uint8Array(128))
  const [editing, setEditing] = useState(null)
  const [editBuf, setEditBuf] = useState('')
  const [rows, setRows] = useState(8)
  const [addrBuf, setAddrBuf] = useState(hex4(memStart))
  const [cursor, setCursor] = useState(memStart)
  const addrFocused = useRef(false)
  const COLS = 16
  const scrollRef = useRef(null)
  const panelRef  = useRef(null)

  useEffect(() => { if (!addrFocused.current) setAddrBuf(hex4(memStart)) }, [memStart])

  // When viewport jumps externally (address input, ◀/▶), clamp cursor into view
  useEffect(() => {
    setCursor(c => {
      const visEnd = memStart + COLS * rows - 1
      return (c < memStart || c > visEnd) ? memStart : c
    })
  }, [memStart, rows])

  useEffect(() => {
    if (!scrollRef.current) return
    const ro = new ResizeObserver(([e]) => {
      setRows(r => { const n = Math.max(2, Math.floor((e.contentRect.height - 22) / 20)); return n !== r ? n : r })
    })
    ro.observe(scrollRef.current)
    return () => ro.disconnect()
  }, [])

  function onHandleMouseDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelRef.current.getBoundingClientRect().height
    function onMove(ev) {
      panelRef.current.style.height = Math.max(80, startH + (startY - ev.clientY)) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function refresh() { setMem(sim.simGetMemory(memStart, COLS * rows)) }
  useEffect(refresh, [memStart, regs.pc, rows, buildId])

  function commit(addr, raw) {
    const v = parseInt(raw, 16)
    if (!isNaN(v)) sim.simWriteByte(addr, v)
    setEditing(null)
    refresh()
  }

  function moveCursor(delta) {
    const next = Math.max(0, Math.min(0xFFFF, cursor + delta))
    setCursor(next)
    const visEnd = memStart + COLS * rows - 1
    if (next < memStart) {
      onJump((next >> 4) << 4)
    } else if (next > visEnd) {
      onJump(Math.max(0, ((next >> 4) << 4) - COLS * (rows - 1)))
    }
  }

  function onPanelKey(e) {
    if (addrFocused.current || editing !== null) return
    const pageSize = COLS * rows
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveCursor(-COLS) }
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveCursor(+COLS) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); moveCursor(-1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor(+1) }
    if (e.key === 'PageUp')     { e.preventDefault(); moveCursor(-pageSize) }
    if (e.key === 'PageDown')   { e.preventDefault(); moveCursor(+pageSize) }
  }

  return (
    <div className="panel mem-panel" ref={panelRef} tabIndex={0} onKeyDown={onPanelKey}>
      <div className="mem-resize-handle" onMouseDown={onHandleMouseDown} />
      <div className="panel-hd">
        MEMORY
        <span className="mem-ctrl">
          <button className="mem-btn" onClick={() => onJump(Math.max(0, memStart - COLS*rows))}>◀</button>
          <input
            className="mem-cur-addr"
            value={addrBuf}
            maxLength={4}
            spellCheck={false}
            onChange={e => setAddrBuf(e.target.value.toUpperCase())}
            onFocus={e => { addrFocused.current = true; e.target.select() }}
            onBlur={() => { addrFocused.current = false; setAddrBuf(hex4(memStart)) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { const v = parseInt(addrBuf, 16); if (!isNaN(v)) onJump(v & 0xFFF0); e.target.blur() }
              if (e.key === 'Escape') { setAddrBuf(hex4(memStart)); e.target.blur() }
            }}
          />
          <button className="mem-btn" onClick={() => onJump(Math.min(0x3F00, memStart + COLS*rows))}>▶</button>
        </span>
      </div>
      <div className="mem-scroll" ref={scrollRef}>
        <table className="mem-tbl">
          <thead>
            <tr>
              <th className="mem-th-addr"></th>
              {Array.from({length:COLS},(_,i)=><th key={i} className="mem-th">{hex2(i)}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({length:rows},(_,row)=>{
              const base = memStart + row*COLS
              return (
                <tr key={row}>
                  <td className="mem-row-addr">{hex4(base)}</td>
                  {Array.from({length:COLS},(_,col)=>{
                    const addr = base + col
                    const val  = mem[row*COLS+col] ?? 0
                    const isPC     = addr === regs.pc
                    const isSP     = addr === regs.sp
                    const isCursor = addr === cursor
                    if (editing === addr)
                      return (
                        <td key={col} className="mem-cell editing">
                          <input autoFocus maxLength={2} value={editBuf}
                            onChange={e=>setEditBuf(e.target.value.toUpperCase())}
                            onBlur={()=>commit(addr,editBuf)}
                            onKeyDown={e=>{if(e.key==='Enter')commit(addr,editBuf);if(e.key==='Escape')setEditing(null)}}
                          />
                        </td>
                      )
                    return (
                      <td key={col}
                        className={`mem-cell${isPC?' mem-pc':''}${isSP?' mem-sp':''}${isCursor?' mem-cursor':''}${val?' mem-nz':''}`}
                        title={`${hex4(addr)}: ${hex2(val)}H = ${val}`}
                        onClick={()=>setCursor(addr)}
                        onDoubleClick={()=>{setEditing(addr);setEditBuf(hex2(val))}}
                      >{hex2(val)}</td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mem-legend">
        <span className="legend-pc">■</span> PC &nbsp;
        <span className="legend-sp">■</span> SP &nbsp;
        <span className="legend-tip">double-click to edit · click + ↑↓ PgUp/Dn to scroll</span>
      </div>
    </div>
  )
}

// ── Stack panel ──────────────────────────────────────────────────────────
function StackPanel({ regs }) {
  const entries = useMemo(() => {
    const out = []
    for (let i = 0; i < 6; i++) {
      const a = (regs.sp + i*2) & 0xFFFF
      if (a >= 0x4000) break
      out.push({ addr: a, val: sim.simReadByte(a) | (sim.simReadByte(a+1)<<8) })
    }
    return out
  }, [regs.sp])

  return (
    <div className="panel stack-panel">
      <div className="panel-hd">STACK  <code className="sp-val">SP={hex4(regs.sp)}</code></div>
      {entries.length === 0
        ? <div className="stack-empty">empty</div>
        : entries.map((e,i) => (
          <div key={e.addr} className={`stack-row${i===0?' stack-top':''}`}>
            <span className="stack-addr">{hex4(e.addr)}</span>
            <span className="stack-sep">→</span>
            <span className="stack-val">{hex4(e.val)}</span>
          </div>
        ))
      }
    </div>
  )
}

// ── LED display ──────────────────────────────────────────────────────────
function LedDisplay({ leds }) {
  const LABELS = ['ST₁','ST₀','A₃','A₂','A₁','A₀','D₁','D₀']
  return (
    <div className="panel led-panel">
      <div className="panel-hd">LED DISPLAY</div>
      <div className="led-digits">
        {leds.map((v,i) => (
          <div key={i} className="led-digit">
            <SevenSeg value={v} />
            <div className="led-lbl">{LABELS[i]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Instruction help modal ───────────────────────────────────────────────
function HelpModal({ instruction, onClose }) {
  const inst = INST_HELP[instruction]
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!inst) return null
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-hd">
          <span className="help-mnem">{instruction}</span>
          <button className="help-close" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">
          <p className="help-brief">{inst.brief}</p>
          <div className="help-meta">
            <span><span className="help-lbl">Flags</span>{inst.flags}</span>
            <span><span className="help-lbl">Size</span>{inst.bytes} byte{inst.bytes !== 1 ? 's' : ''}</span>
            <span><span className="help-lbl">Cycles</span>{inst.cycles}</span>
          </div>
          <p className="help-desc">{inst.desc}</p>
          <pre className="help-ex">{inst.ex}</pre>
        </div>
      </div>
    </div>
  )
}

// ── Root app ─────────────────────────────────────────────────────────────
export default function App() {
  const [src, setSrc]           = useState(EXAMPLES['Counter'])
  const [regs, setRegs]         = useState({a:0,b:0,c:0,d:0,e:0,h:0,l:0,flags:0,pc:0x100,sp:0,flagS:0,flagZ:0,flagAC:0,flagP:0,flagCY:0,halted:false,hasError:false})
  const [prevRegs, setPrev]     = useState(null)
  const [leds, setLeds]         = useState(Array(8).fill(0))
  const [bps, setBps]           = useState(new Set())
  const [memStart, setMemStart] = useState(0x100)
  const [appState, setAppState] = useState('idle')  // idle | running | halted | error
  const [msg, setMsg]           = useState('Load an example or write code, then click Build.')
  const [steps, setSteps]       = useState(0)
  const [buildId, setBuildId]   = useState(0)
  const [cursorInst, setCursorInst] = useState(null)
  const [helpInst, setHelpInst]     = useState(null)
  const timerRef    = useRef(null)
  const editorColRef = useRef(null)
  const srcRef      = useRef(src)

  function onEditorResizeDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = editorColRef.current.getBoundingClientRect().width
    function onMove(ev) {
      editorColRef.current.style.flexBasis = Math.max(180, Math.min(640, startW + (ev.clientX - startX))) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => { sim.simInit(); doAssemble(src); }, [])

  const hotkeysRef = useRef(null)
  useEffect(() => { hotkeysRef.current = { doAssemble, handleReset, doStep, handleRun, running } })
  useEffect(() => {
    function onKey(e) {
      const h = hotkeysRef.current
      if (e.key === 'F5') { e.preventDefault(); h.doAssemble(srcRef.current) }
      if (e.key === 'F6') { e.preventDefault(); h.handleReset() }
      if (e.key === 'F7') { e.preventDefault(); if (!h.running) h.doStep() }
      if (e.key === 'F9') { e.preventDefault(); h.handleRun() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function refresh() {
    const r = sim.simGetRegisters()
    setRegs(old => { setPrev(old); return r })
    setLeds(sim.simGetAllLeds())
  }

  function doAssemble(code) {
    try {
      stopRun()
      sim.simInit()
      const res = sim.simAssemble(code)
      setBuildId(id => id + 1)
      setSteps(0)
      refresh()
      if (!res.ok) {
        setAppState('error')
        setMsg(`✗ ${res.errorMsg}`)
      } else {
        setAppState('idle')
        const t = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})
        setMsg(`✓ ${res.bytesEmitted}B at ${hex4(res.entryPoint)}H — ready  ${t}`)
      }
    } catch (err) {
      console.error('[doAssemble] EXCEPTION:', err)
      setAppState('error')
      setMsg(`✗ Internal error: ${err.message}`)
    }
  }

  function doStep() {
    stopRun()
    const ok = sim.simStep()
    setSteps(s => s+1)
    refresh()
    if (!ok) {
      setAppState(sim.simIsHalted() ? 'halted' : 'error')
      setMsg(sim.simIsHalted() ? '■ Program halted.' : `✗ ${sim.simGetError()}`)
    }
  }

  function startRun() {
    if (timerRef.current) return
    setAppState('running')
    setMsg('▶ Running…')
    timerRef.current = setInterval(() => {
      const n = sim.simRun(1000)
      setSteps(s => s + n)
      refresh()
      if (!sim.simIsRunning()) {
        stopRun()
        setAppState(sim.simIsHalted() ? 'halted' : 'error')
        setMsg(sim.simIsHalted() ? '■ Program halted.' : `✗ ${sim.simGetError()}`)
      }
    }, 16)
  }

  function stopRun() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (appState === 'running') setAppState('idle')
  }

  function handleRun() { appState === 'running' ? stopRun() : startRun() }

  function handleReset() { doAssemble(srcRef.current) }

  function toggleBp(addr) {
    sim.simSetBreakpoint(addr)
    setBps(new Set(sim.simGetBreakpoints()))
  }

  function loadExample(name) {
    const code = EXAMPLES[name]
    srcRef.current = code
    setSrc(code)
    doAssemble(code)
  }

  const running = appState === 'running'

  return (
    <div className="app">
      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-chip">8085</div>
          <div className="brand-text">
            <span className="brand-title">Simulator</span>
            <span className="brand-sub">original by V. Kumar · 1997 · ported to web</span>
          </div>
        </div>

        <div className="toolbar">
          <select className="ex-select" defaultValue="" onChange={e => { if(e.target.value) loadExample(e.target.value) }}>
            <option value="" disabled>Load example…</option>
            {Object.keys(EXAMPLES).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="btn btn-asm"   onClick={() => doAssemble(srcRef.current)}>⚙ Build  <kbd>F5</kbd></button>
          <button className="btn btn-step"  onClick={doStep}  disabled={running}>↓ Step  <kbd>F7</kbd></button>
          <button className={`btn ${running ? 'btn-stop':'btn-run'}`} onClick={handleRun}>
            {running ? '■ Stop' : '▶ Run'}  <kbd>{running?'F9':'F9'}</kbd>
          </button>
          <button className="btn btn-reset" onClick={handleReset}>↺ Reset  <kbd>F6</kbd></button>
        </div>

        <div className={`status status-${appState}`}>
          <span className="status-msg">{msg}</span>
          {cursorInst && INST_HELP[cursorInst] && (
            <span className="status-inst">
              <span className="status-inst-name">{cursorInst}</span>
              <span className="status-inst-brief">{INST_HELP[cursorInst].brief}</span>
              <kbd className="status-inst-tip">Ctrl+click</kbd>
            </span>
          )}
          {steps > 0 && <span className="status-steps">{steps.toLocaleString()} steps</span>}
        </div>
      </div>

      {/* ── Workspace ── */}
      <div className="workspace">
        {/* Editor column */}
        <div className="col col-editor" ref={editorColRef}>
          <div className="panel editor-panel">
            <div className="panel-hd">EDITOR  <span className="editor-hint">; semicolons for comments</span></div>
            <AsmEditor value={src} onChange={v => { srcRef.current = v; setSrc(v) }}
              onCursorInstruction={setCursorInst}
              onInstructionDetail={setHelpInst} />
          </div>
          <LedDisplay leds={leds} />
        </div>
        <div className="col-resize-handle" onMouseDown={onEditorResizeDown} />

        {/* Code + Memory column */}
        <div className="col col-center">
          <DisasmPanel regs={regs} breakpoints={bps} onToggleBp={toggleBp} buildId={buildId} />
          <MemPanel
            memStart={memStart}
            onJump={setMemStart}
            regs={regs}
            buildId={buildId}
          />
          <div className="jump-row">
            <button className="btn btn-xs" onClick={()=>setMemStart(regs.pc & 0xFFF0)}>→ PC</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(regs.sp & 0xFFF0)}>→ SP</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(0x100)}>→ 100H</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(0x200)}>→ 200H</button>
          </div>
        </div>

        {/* Registers column */}
        <div className="col col-right">
          <RegPanel   regs={regs} prev={prevRegs} />
          <FlagPanel  regs={regs} />
          <StackPanel regs={regs} />
        </div>
      </div>
      {helpInst && <HelpModal instruction={helpInst} onClose={() => setHelpInst(null)} />}
    </div>
  )
}
