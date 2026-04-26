import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration } from '@codemirror/view'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import * as sim from './sim8085Bridge.js'
import './App.css'

// ── Example programs (grouped by category) ──────────────────────────────
const EXAMPLES = {

  'Basic': {
    'Counter': `; Increment A and B registers in a tight loop.
; Watch the Registers panel update live.
    org 100H
    kickoff 100H
    mvi a, 00H
    mvi b, 00H
loop:
    inr a
    inr b
    jnz loop
    hlt`,
  },

  'Arithmetic': {
    'Add': `; 8-bit addition: mem[200H] + mem[201H] → mem[202H]
; If the sum overflows 8 bits, CY flag is set.
    org 100H
    kickoff 100H
    setbyte 200H, 3CH   ; 60
    setbyte 201H, 2AH   ; 42  (sum = 102 = 66H)
    lda 200H
    mov b, a
    lda 201H
    add b               ; A = sum,  CY set on overflow
    sta 202H
    mvi a, 00H
    adc a               ; A = carry (0 or 1)
    sta 203H
    hlt`,

    'Subtract': `; 8-bit subtraction: mem[200H] - mem[201H] → mem[202H]
; CY=1 after SUB means borrow (result negative).
    org 100H
    kickoff 100H
    setbyte 200H, 5AH   ; 90  (minuend)
    setbyte 201H, 1EH   ; 30  (subtrahend)  result = 60 = 3CH
    lda 201H
    mov b, a            ; B = subtrahend
    lda 200H
    sub b               ; A = minuend - subtrahend
    sta 202H
    hlt`,

    'Multiply': `; 8-bit multiply via repeated addition (result is 16-bit)
; mem[200H] x mem[201H] → mem[202H](lo), mem[203H](hi)
    org 100H
    kickoff 100H
    setbyte 200H, 0CH   ; multiplicand = 12
    setbyte 201H, 0AH   ; multiplier   = 10  (product = 120 = 78H)
    lda 200H
    mov b, a            ; B = multiplicand
    lda 201H
    mov c, a            ; C = multiplier (loop count)
    lxi h, 0000H        ; HL = running product
    mov a, c
    ora a
    jz done             ; multiplier = 0 → result = 0
mul:
    mov a, l
    add b
    mov l, a
    mov a, h
    aci 00H             ; propagate carry into high byte
    mov h, a
    dcr c
    jnz mul
done:
    shld 202H           ; store 16-bit result (lo at 202H, hi at 203H)
    hlt`,

    'Divide': `; 8-bit divide: mem[200H] / mem[201H]
; Quotient → mem[202H],  Remainder → mem[203H]
    org 100H
    kickoff 100H
    setbyte 200H, 64H   ; dividend  = 100
    setbyte 201H, 07H   ; divisor   =   7  (quotient=14, remainder=2)
    lda 201H
    mov c, a            ; C = divisor
    lda 200H
    mov b, a            ; B = working dividend
    mvi d, 00H          ; D = quotient
div:
    mov a, b
    sub c               ; A = B - divisor
    jc  done            ; borrow → B < divisor → done
    mov b, a            ; B = new remainder
    inr d               ; quotient++
    jmp div
done:
    mov a, d
    sta 202H            ; quotient
    mov a, b
    sta 203H            ; remainder
    hlt`,

    '16-bit Add': `; Add two 16-bit values using DAD (HL = HL + DE).
; Operand 1 at 200H-201H (lo-hi), operand 2 at 202H-203H.
; 16-bit result stored at 204H-205H.  CY = carry out.
    org 100H
    kickoff 100H
    setword 200H, 12A4H ; first  operand = 12A4H (4772)
    setword 202H, 0E73H ; second operand = 0E73H (3699)
    lhld 200H           ; HL = first operand
    xchg                ; DE = first operand
    lhld 202H           ; HL = second operand
    dad d               ; HL = HL + DE  (result = 2117H = 8471)
    shld 204H           ; store result
    hlt`,

    'BCD Add': `; BCD (packed) addition using DAA.
; Two BCD digits in A and B are added and adjusted.
; Result in A is a valid two-digit BCD number.
    org 100H
    kickoff 100H
    mvi a, 47H          ; BCD 47 (= decimal 47)
    mvi b, 35H          ; BCD 35 (= decimal 35)
    add b               ; binary sum = 7CH (wrong for BCD)
    daa                 ; adjust → A = 82H (BCD 82 = decimal 82)
    sta 200H
    hlt`,
  },

  'Logic': {
    'AND / OR / XOR': `; Demonstrate bitwise AND, OR, and XOR.
; Operands: F0H (11110000) and AAH (10101010)
; AND → A0H   OR → FAH   XOR → 5AH
    org 100H
    kickoff 100H
    setbyte 200H, 0F0H
    setbyte 201H, 0AAH
    lda 200H
    mov b, a
    lda 201H
    ana b               ; AND: F0 & AA = A0H
    sta 202H
    lda 200H
    mov b, a
    lda 201H
    ora b               ; OR:  F0 | AA = FAH
    sta 203H
    lda 200H
    mov b, a
    lda 201H
    xra b               ; XOR: F0 ^ AA = 5AH
    sta 204H
    hlt`,

    'Bit Test': `; Test whether bit 3 of mem[200H] is set.
; Result at 201H: 01H = bit set,  00H = bit clear.
    org 100H
    kickoff 100H
    setbyte 200H, 2CH   ; 0010 1100 — bit 3 is 1
    lda 200H
    ani 08H             ; mask bit 3  (08H = 0000 1000)
    jz  clear
    mvi a, 01H          ; bit was set
    sta 201H
    hlt
clear:
    mvi a, 00H          ; bit was clear
    sta 201H
    hlt`,

    'Complement & Rotate': `; Show CMA (bitwise NOT) and RLC/RRC rotations.
    org 100H
    kickoff 100H
    mvi a, 0F0H         ; A = 1111 0000
    cma                 ; A = ~A = 0000 1111 = 0FH
    sta 200H
    mvi a, 01H          ; A = 0000 0001
    rlc                 ; A = 0000 0010  CY=0
    rlc                 ; A = 0000 0100
    rlc                 ; A = 0000 1000
    rlc                 ; A = 0001 0000 = 10H
    sta 201H
    mvi a, 80H          ; A = 1000 0000
    rrc                 ; A = 0100 0000  CY=0
    rrc                 ; A = 0010 0000
    rrc                 ; A = 0001 0000 = 10H
    sta 202H
    hlt`,
  },

  'Memory': {
    'Block Move': `; Copy 8 bytes from source (200H) to destination (300H).
    org 100H
    kickoff 100H
    setbyte 200H, 11H
    setbyte 201H, 22H
    setbyte 202H, 33H
    setbyte 203H, 44H
    setbyte 204H, 55H
    setbyte 205H, 66H
    setbyte 206H, 77H
    setbyte 207H, 88H
    lxi h, 200H         ; HL = source
    lxi d, 300H         ; DE = destination
    mvi c, 08H          ; C  = byte count
copy:
    mov a, m            ; A = mem[HL]
    stax d              ; mem[DE] = A
    inx h
    inx d
    dcr c
    jnz copy
    hlt`,

    'Memory Fill': `; Fill 16 bytes starting at 200H with the value AAH.
    org 100H
    kickoff 100H
    lxi h, 200H         ; start address
    mvi b, 10H          ; count = 16
    mvi a, 0AAH         ; fill value
fill:
    mov m, a
    inx h
    dcr b
    jnz fill
    hlt`,

    'Find Maximum': `; Find the largest byte in an 8-element array at 200H.
; Result stored at 210H.
    org 100H
    kickoff 100H
    setbyte 200H, 34H
    setbyte 201H, 78H
    setbyte 202H, 12H
    setbyte 203H, 9AH
    setbyte 204H, 56H
    setbyte 205H, 0BH
    setbyte 206H, 0EFH
    setbyte 207H, 23H
    lxi h, 200H
    mvi b, 08H          ; element count
    mvi a, 00H          ; current max
scan:
    cmp m               ; A vs mem[HL]
    jnc skip            ; if A >= mem[HL], keep A
    mov a, m            ; new maximum found
skip:
    inx h
    dcr b
    jnz scan
    sta 210H            ; store result (EFH = 239)
    hlt`,

    'Find Minimum': `; Find the smallest byte in an 8-element array at 200H.
; Result stored at 210H.
    org 100H
    kickoff 100H
    setbyte 200H, 34H
    setbyte 201H, 78H
    setbyte 202H, 12H
    setbyte 203H, 9AH
    setbyte 204H, 56H
    setbyte 205H, 0BH
    setbyte 206H, 0EFH
    setbyte 207H, 23H
    lxi h, 200H
    mvi b, 08H
    mov a, m            ; seed with first element
    inx h
    dcr b
scan:
    cmp m               ; A vs mem[HL]
    jc  skip            ; if A < mem[HL], A is still smaller
    mov a, m            ; new minimum found
skip:
    inx h
    dcr b
    jnz scan
    sta 210H            ; store result (0BH = 11)
    hlt`,
  },

  'Sorting': {
    'Bubble Sort': `; Bubble sort — sorts 10 values at 251H..25AH into ascending order.
    setbyte 251H, 34H
    setbyte 252H, 30H
    setbyte 253H, 26H
    setbyte 254H, 23H
    setbyte 255H, 20H
    setbyte 256H, 17H
    setbyte 257H, 14H
    setbyte 258H, 10H
    setbyte 259H, 07H
    setbyte 25AH, 03H

    org 100H
    kickoff 100H
    mvi  b, 09H
outer:
    lxi  h, 251H
    mov  c, b
inner:
    mov  a, m
    inx  h
    cmp  m
    jc   next
    mov  d, m           ; swap mem[HL-1] and mem[HL]
    mov  m, a
    dcx  h
    mov  m, d
    inx  h
next:
    dcr  c
    jnz  inner
    dcr  b
    jnz  outer
    hlt`,

    'Selection Sort': `; Selection sort — finds the minimum and places it at the front.
; Sorts 8 bytes at 200H..207H into ascending order.
    setbyte 200H, 45H
    setbyte 201H, 12H
    setbyte 202H, 78H
    setbyte 203H, 03H
    setbyte 204H, 9AH
    setbyte 205H, 56H
    setbyte 206H, 23H
    setbyte 207H, 67H

    org 100H
    kickoff 100H
    mvi  e, 08H         ; total elements
    lxi  h, 200H        ; outer pointer (i)
outer:
    dcr  e
    jz   done
    mov  d, e           ; inner count
    push h              ; save i
    mov  b, h           ; min pointer = i (hi)
    mov  c, l           ; min pointer = i (lo)
    mov  a, m           ; current min value
    inx  h
inner:
    cmp  m
    jc   no_swap
    mov  a, m           ; new min value
    mov  b, h
    mov  c, l           ; save address of new min
no_swap:
    inx  h
    dcr  d
    jnz  inner
    ; swap mem[i] and mem[min_addr]
    pop  h              ; HL = i
    push h
    mov  d, a           ; D = min value
    mov  a, m           ; A = mem[i]
    push b
    pop  h              ; HL = min address
    mov  m, a           ; mem[min] = old mem[i]
    pop  h              ; HL = i again
    mov  m, d           ; mem[i] = min value
    inx  h
    jmp  outer
done:
    hlt`,
  },

  'Algorithms': {
    'Fibonacci': `; Fibonacci sequence — stores 16 values starting at 200H.
; F(0)=0, F(1)=1, F(2)=1, F(3)=2 … F(15)=EFH (wraps at 256)
    org 100H
    kickoff 100H
    lxi  h, 200H
    mvi  a, 00H
    mov  m, a           ; F(0) = 0
    inx  h
    mvi  a, 01H
    mov  m, a           ; F(1) = 1
    inx  h
    mvi  b, 0EH         ; compute 14 more terms
fib:
    dcx  h
    mov  a, m           ; A = F(n-1)
    inx  h
    add  m              ; A = F(n-1) + F(n) = F(n+1)
    inx  h
    mov  m, a
    dcr  b
    jnz  fib
    hlt`,

    'Factorial': `; Compute N! using repeated multiplication (repeated addition).
; N stored at 200H.  Result at 201H.  Valid for N <= 5 (5! = 120).
    org 100H
    kickoff 100H
    setbyte 200H, 05H   ; N = 5  →  5! = 120 = 78H
    lda 200H
    mov b, a            ; B = current factor (counts down N..1)
    mvi a, 01H          ; A = running result = 1
loop:
    mov c, a            ; C = current result
    mov d, b            ; D = factor (multiply count)
    mvi a, 00H
mul:
    add c               ; A += C  (repeated D times = C * B)
    dcr d
    jnz mul
    dcr b               ; next factor
    jnz loop
    sta 201H            ; store result
    hlt`,

    'GCD': `; Greatest common divisor — Euclid's subtraction algorithm.
; GCD(mem[200H], mem[201H]) stored at 202H.
    org 100H
    kickoff 100H
    setbyte 200H, 30H   ; 48
    setbyte 201H, 14H   ; 20   GCD = 4
    lda 200H
    mov b, a            ; B = first value
    lda 201H
    mov c, a            ; C = second value
gcd:
    mov a, b
    cmp c
    jz  done            ; B == C → answer found
    jc  b_lt            ; B < C  → subtract other way
    sub c
    mov b, a            ; B = B - C
    jmp gcd
b_lt:
    mov a, c
    sub b
    mov c, a            ; C = C - B
    jmp gcd
done:
    mov a, b
    sta 202H
    hlt`,

    'Checksum': `; XOR checksum of a 5-byte block at 200H.  Result at 300H.
    org 100H
    kickoff 100H
    setbyte 200H, 0AH
    setbyte 201H, 1BH
    setbyte 202H, 2CH
    setbyte 203H, 3DH
    setbyte 204H, 4EH
    lxi h, 200H
    mvi b, 05H
    mvi a, 00H
xloop:
    xra m               ; A ^= mem[HL]
    inx h
    dcr b
    jnz xloop
    sta 300H            ; checksum = 0AH^1BH^2CH^3DH^4EH = 10H
    hlt`,
  },

  'Tests': {

    'Data Transfer': `; ── DATA TRANSFER TESTS ──────────────────────────────────────────
; Tests: MVI, MOV, MOV M, LDA/STA, LHLD/SHLD, LDAX/STAX, XCHG, LXI
; Run → should reach HLT cleanly. Any ASSERT failure stops with error.
    org     100H
    kickoff 100H

; MVI: load immediate value
    mvi a, 42H
    assert A, 42H

; MOV r,r: register to register
    mvi b, 0AAH
    mov a, b
    assert A, 0AAH
    mvi c, 55H
    mov b, c
    assert B, 55H

; MOV to/from M (memory via HL)
    lxi h, 300H
    mvi m, 7FH
    mov a, m
    assert A, 7FH
    assert MEM, 300H, 7FH

; STA / LDA: direct memory access
    mvi a, 0A5H
    sta 400H
    mvi a, 00H
    lda 400H
    assert A, 0A5H
    assert MEM, 400H, 0A5H

; SHLD / LHLD: 16-bit memory access (HL stored little-endian)
    lxi h, 1234H
    shld 500H
    lxi h, 0000H
    lhld 500H
    assert HL, 1234H
    assert MEM, 500H, 34H     ; low byte first
    assert MEM, 501H, 12H     ; high byte second

; STAX / LDAX via BC
    lxi b, 600H
    mvi a, 0CDH
    stax b
    mvi a, 00H
    ldax b
    assert A, 0CDH
    assert MEM, 600H, 0CDH

; STAX / LDAX via DE
    lxi d, 601H
    mvi a, 0EFH
    stax d
    mvi a, 00H
    ldax d
    assert A, 0EFH

; XCHG: swap DE and HL
    lxi h, 1111H
    lxi d, 2222H
    xchg
    assert HL, 2222H
    assert DE, 1111H

; LXI SP
    lxi sp, 3FFEH
    assert SP, 3FFEH

    hlt`,

    'ADD & ADC': `; ── ADD & ADC TESTS ──────────────────────────────────────────────
; Covers: ADD r, ADD M, ADI, ADC r, ACI, ADD A (self)
; Corner cases: carry out, zero result, sign bit, carry propagation
    org     100H
    kickoff 100H

; ADD r: basic addition
    mvi a, 05H
    mvi b, 03H
    add b
    assert A, 08H
    assert CY, 0
    assert Z,  0
    assert S,  0

; ADD r: result is zero
    mvi a, 00H
    mvi b, 00H
    add b
    assert A, 00H
    assert Z,  1
    assert CY, 0

; ADD r: overflow → carry out (FFH + 01H = 00H, CY=1)
    mvi a, 0FFH
    mvi b, 01H
    add b
    assert A, 00H
    assert CY, 1
    assert Z,  1

; ADD r: result is negative (bit 7 set) → S=1
    mvi a, 7FH
    mvi b, 01H
    add b
    assert A, 80H
    assert S,  1
    assert CY, 0

; ADI: add immediate (wraps with carry)
    mvi a, 0FAH
    adi 0AH
    assert A, 04H
    assert CY, 1

; ADD A: double accumulator (A = A + A)
    mvi a, 40H
    add a
    assert A, 80H
    assert S,  1
    assert CY, 0

; ADD M: add memory byte via HL
    lxi h, 300H
    mvi m, 22H
    mvi a, 11H
    add m
    assert A, 33H
    assert CY, 0

; ADC r: add with carry (CY acts as extra +1)
    stc              ; CY = 1
    mvi a, 10H
    mvi b, 20H
    adc b            ; A = 10 + 20 + 1 = 31H
    assert A, 31H
    assert CY, 0

; ACI: add immediate with carry
    stc              ; CY = 1
    mvi a, 0FFH
    aci 00H          ; FFH + 00H + 1 = 00H, CY=1
    assert A, 00H
    assert CY, 1
    assert Z,  1

; ADC A with carry: A = A + A + CY
    stc              ; CY = 1
    mvi a, 40H
    adc a            ; 40 + 40 + 1 = 81H
    assert A, 81H
    assert S,  1
    assert CY, 0

    hlt`,

    'SUB & SBB': `; ── SUB & SBB TESTS ──────────────────────────────────────────────
; Covers: SUB r, SUB A, SUI, SBB r, SBI
; Corner cases: borrow (CY=1), zero result, sign, SBB propagation
    org     100H
    kickoff 100H

; SUB r: basic subtraction
    mvi a, 0AH
    mvi b, 03H
    sub b
    assert A, 07H
    assert CY, 0
    assert Z,  0
    assert S,  0

; SUB r: result is zero
    mvi a, 05H
    mvi b, 05H
    sub b
    assert A, 00H
    assert Z,  1
    assert CY, 0

; SUB r: borrow (underflow) → CY=1, S=1
    mvi a, 02H
    mvi b, 05H
    sub b
    assert A, 0FDH
    assert CY, 1
    assert S,  1
    assert Z,  0

; SUB A: A - A = 0  (CY and S always clear, Z always set)
    mvi a, 55H
    sub a
    assert A, 00H
    assert Z,  1
    assert CY, 0
    assert S,  0

; SUI: subtract immediate, no borrow
    mvi a, 50H
    sui 10H
    assert A, 40H
    assert CY, 0

; SUI: subtract immediate with borrow
    mvi a, 10H
    sui 20H
    assert A, 0F0H
    assert CY, 1
    assert S,  1

; SBB r: subtract with borrow-in (CY=1 → result is one less)
    stc              ; set borrow in
    mvi a, 10H
    mvi b, 05H
    sbb b            ; A = 10H - 05H - 1 = 0AH
    assert A, 0AH
    assert CY, 0

; SBB r: borrow propagation (00H - 00H - 1 = FFH, CY=1)
    stc
    mvi a, 00H
    mvi b, 00H
    sbb b
    assert A, 0FFH
    assert CY, 1
    assert S,  1

; SBI: subtract immediate with borrow
    stc
    mvi a, 20H
    sbi 10H          ; 20H - 10H - 1 = 0FH
    assert A, 0FH
    assert CY, 0

    hlt`,

    'INC & DEC': `; ── INR / DCR / INX / DCX TESTS ──────────────────────────────────
; KEY RULE: INR/DCR do NOT affect CY.  INX/DCX affect NO flags at all.
    org     100H
    kickoff 100H

; INR r: basic increment
    mvi b, 05H
    inr b
    assert B, 06H
    assert Z,  0
    assert S,  0

; INR r: FFH → 00H  (Z=1, but CY NOT set — INR never touches CY)
    stc              ; pre-set CY=1 to prove INR preserves it
    mvi a, 0FFH
    inr a
    assert A, 00H
    assert Z,  1
    assert CY, 1     ; CY unchanged from before INR

; INR r: 7FH → 80H  (S=1, AC=1, Z=0, CY unchanged)
    mvi a, 7FH
    inr a
    assert A, 80H
    assert S,  1
    assert Z,  0

; DCR r: basic decrement
    mvi c, 05H
    dcr c
    assert C, 04H
    assert Z,  0

; DCR r: 01H → 00H  (Z=1)
    mvi a, 01H
    dcr a
    assert A, 00H
    assert Z,  1
    assert S,  0

; DCR r: 00H → FFH  (S=1, CY NOT set — DCR never touches CY)
    mvi a, 00H
    sub a            ; clear CY explicitly via SUB A
    dcr a
    assert A, 0FFH
    assert S,  1
    assert Z,  0
    assert CY, 0     ; CY still 0 (from SUB A), not touched by DCR

; INR M: increment memory byte
    lxi h, 300H
    mvi m, 0FEH
    inr m
    assert MEM, 300H, 0FFH
    inr m            ; FFH → 00H
    assert MEM, 300H, 00H
    assert Z,  1

; INX: 16-bit increment — wraps FFFFH → 0000H, NO flags touched
    stc              ; CY=1 before INX to prove flags unchanged
    lxi b, 0FFFFH
    inx b
    assert BC, 0000H
    assert CY, 1     ; INX must not clear CY

; DCX: 16-bit decrement — wraps 0000H → FFFFH, NO flags touched
    lxi d, 0000H
    dcx d
    assert DE, 0FFFFH

    hlt`,

    'AND / OR / XOR': `; ── ANA / ORA / XRA / CMA TESTS ──────────────────────────────────
; KEY FLAG RULES: all logical ops → CY=0 always.
; ANA also sets AC=0.  ORA/XRA set AC=0.
    org     100H
    kickoff 100H

; ANA r: bitwise AND, CY always 0
    stc              ; pre-set CY to prove AND clears it
    mvi a, 0FFH
    mvi b, 0F0H
    ana b
    assert A, 0F0H
    assert CY, 0
    assert S,  1
    assert Z,  0

; ANA r: result zero
    mvi a, 0F0H
    mvi b, 0FH
    ana b
    assert A, 00H
    assert Z,  1
    assert CY, 0

; ANI: AND immediate
    mvi a, 0ABH
    ani 0FH
    assert A, 0BH
    assert CY, 0

; ORA r: bitwise OR, CY always 0
    stc              ; prove CY gets cleared
    mvi a, 0F0H
    mvi b, 0FH
    ora b
    assert A, 0FFH
    assert CY, 0
    assert S,  1

; ORA A: self-OR (no change, just updates flags)
    mvi a, 55H
    ora a
    assert A, 55H
    assert CY, 0

; ORI: OR immediate
    mvi a, 00H
    ori 0FFH
    assert A, 0FFH
    assert Z,  0
    assert S,  1

; XRA r: bitwise XOR
    mvi a, 0FFH
    mvi b, 0FFH
    xra b
    assert A, 00H
    assert Z,  1
    assert CY, 0

; XRA A: self-XOR always gives zero — fastest way to clear A and set Z
    mvi a, 0ABH
    xra a
    assert A, 00H
    assert Z,  1
    assert CY, 0

; XRI: XOR immediate, toggle bits
    mvi a, 0F0H
    xri 0FFH
    assert A, 0FH
    assert S,  0
    assert CY, 0

; CMA: complement A (bitwise NOT) — does NOT affect flags
    stc
    mvi a, 55H
    cma
    assert A, 0AAH
    assert CY, 1     ; CMA leaves flags untouched

    hlt`,

    'Compare & Flags': `; ── CMP / CPI / STC / CMC / CMA TESTS ────────────────────────────
; CMP subtracts but discards result. CY=1 means A < operand (borrow).
    org     100H
    kickoff 100H

; CMP r: equal  (Z=1, CY=0)
    mvi a, 42H
    mvi b, 42H
    cmp b
    assert Z,  1
    assert CY, 0
    assert A, 42H    ; CMP must NOT change A

; CMP r: A > B  (Z=0, CY=0, no borrow)
    mvi a, 50H
    mvi b, 30H
    cmp b
    assert Z,  0
    assert CY, 0

; CMP r: A < B  (Z=0, CY=1, borrow occurred)
    mvi a, 10H
    mvi b, 20H
    cmp b
    assert Z,  0
    assert CY, 1

; CMP A: self-compare always equal (Z=1, CY=0, A unchanged)
    mvi a, 0ABH
    cmp a
    assert Z,  1
    assert CY, 0
    assert A, 0ABH

; CPI: compare with immediate
    mvi a, 80H
    cpi 80H
    assert Z,  1
    assert CY, 0

    mvi a, 7FH
    cpi 80H          ; 7FH < 80H unsigned → CY=1
    assert Z,  0
    assert CY, 1

    mvi a, 90H
    cpi 80H          ; 90H > 80H unsigned → CY=0
    assert Z,  0
    assert CY, 0

; STC: set carry unconditionally
    xra a            ; clear flags
    stc
    assert CY, 1

; CMC: complement carry
    stc
    cmc
    assert CY, 0
    cmc
    assert CY, 1

    hlt`,

    'Rotate': `; ── ROTATE INSTRUCTION TESTS ──────────────────────────────────────
; RLC/RRC: circular (bit wraps around, also goes into CY)
; RAL/RAR: rotate through CY (9-bit rotation)
    org     100H
    kickoff 100H

; RLC: bit 7 → CY and bit 0
    mvi a, 80H       ; 10000000
    rlc              ; → 00000001, CY=1
    assert A, 01H
    assert CY, 1

    mvi a, 55H       ; 01010101
    rlc              ; → 10101010, CY=0
    assert A, 0AAH
    assert CY, 0

; RLC four times: should rotate 80H back to 80H
    mvi a, 80H
    rlc
    rlc
    rlc
    rlc
    rlc
    rlc
    rlc
    rlc              ; 8 times = full rotation back
    assert A, 80H

; RRC: bit 0 → CY and bit 7
    mvi a, 01H       ; 00000001
    rrc              ; → 10000000, CY=1
    assert A, 80H
    assert CY, 1

    mvi a, 0AAH      ; 10101010
    rrc              ; → 01010101, CY=0
    assert A, 55H
    assert CY, 0

; RAL: rotate left through CY (9-bit ring)
    mvi a, 80H       ; b7=1
    stc              ; CY=1 going in
    ral              ; A = 00000001 | cy=1 = 01H, new CY = old b7 = 1
    assert A, 01H
    assert CY, 1

    mvi a, 55H       ; 01010101, CY=1 from above
    ral              ; A = 10101010 | 1 = ABH, new CY = old b7(01010101)=0
    assert A, 0ABH
    assert CY, 0

; RAR: rotate right through CY (9-bit ring)
    mvi a, 01H       ; b0=1
    stc              ; CY=1 going in
    rar              ; A = 10000000 = 80H, new CY = old b0 = 1
    assert A, 80H
    assert CY, 1

    mvi a, 0AAH      ; 10101010, CY=1 from above
    rar              ; A = 11010101 = D5H, new CY = old b0(0AAH)=0
    assert A, 0D5H
    assert CY, 0

    hlt`,

    'Jumps': `; ── CONDITIONAL JUMP TESTS ────────────────────────────────────────
; Each test uses ORA A or ADI to set flags, then checks the branch.
; If a jump fails to take (or takes when it should not), HLT is hit early.
    org     100H
    kickoff 100H

; JNZ: jump if Z=0
    mvi a, 01H
    ora a            ; Z=0 (nonzero result)
    jnz t2
    hlt              ; must not reach
t2: assert A, 01H

; JZ: jump if Z=1
    mvi a, 00H
    ora a            ; Z=1
    jz t3
    hlt
t3: assert Z, 1

; JNC: jump if CY=0
    mvi a, 0FFH
    adi 00H          ; FF+00 = FF, no carry
    jnc t4
    hlt
t4: assert CY, 0

; JC: jump if CY=1
    mvi a, 0FFH
    adi 01H          ; FF+01 overflows → CY=1
    jc t5
    hlt
t5: assert CY, 1

; JP: jump if S=0 (positive / non-negative result)
    mvi a, 7FH
    ora a            ; S=0
    jp t6
    hlt
t6: assert S, 0

; JM: jump if S=1 (minus / bit 7 set)
    mvi a, 80H
    ora a            ; S=1
    jm t7
    hlt
t7: assert S, 1

; JPO: jump if parity odd (P=0) — 01H has one 1-bit = odd
    mvi a, 01H
    ora a
    jpo t8
    hlt
t8: assert P, 0

; JPE: jump if parity even (P=1) — 03H = 00000011 has two 1-bits = even
    mvi a, 03H
    ora a
    jpe t9
    hlt
t9: assert P, 1

; JNZ NOT taken: Z=1, JNZ should fall through
    mvi a, 00H
    ora a            ; Z=1
    jnz bad_jnz
    jmp t10
bad_jnz: hlt
t10: assert Z, 1

    hlt`,

    'CALL & RET': `; ── CALL / RET / CONDITIONAL CALL & RETURN TESTS ─────────────────
; CALL pushes PC+3, jumps to subroutine. RET pops and resumes.
    org     100H
    kickoff 100H
    lxi sp, 3FFEH

; Basic CALL / RET
    call sub_basic
    assert A, 0AAH

; CZ: conditional call when Z=1
    mvi a, 00H
    ora a            ; Z=1
    cz sub_cz
    assert A, 0BBH

; CNZ: conditional call when Z=0
    mvi a, 01H
    ora a            ; Z=0
    cnz sub_cnz
    assert A, 0CCH

; CC: conditional call when CY=1
    stc
    cc sub_cc
    assert A, 0DDH

; CNC: conditional call when CY=0 (after CMC, CY becomes 0)
    stc
    cmc              ; CY=0
    cnc sub_cnc
    assert A, 0EEH

; RNZ: return if Z=0 — should return, leaving B unchanged
    mvi b, 01H
    call sub_rnz
    assert B, 01H    ; B stays 01H because RNZ returned before INR B

    hlt

sub_basic:
    mvi a, 0AAH
    ret

sub_cz:
    mvi a, 0BBH
    ret

sub_cnz:
    mvi a, 0CCH
    ret

sub_cc:
    mvi a, 0DDH
    ret

sub_cnc:
    mvi a, 0EEH
    ret

sub_rnz:
    mvi a, 01H
    ora a            ; Z=0
    rnz              ; taken — return here
    inr b            ; NOT reached
    ret`,

    'PUSH & POP': `; ── PUSH / POP TESTS ──────────────────────────────────────────────
; PUSH decrements SP by 2 then writes; POP reads then increments SP by 2.
; Data is stored little-endian: low byte at lower address.
    org     100H
    kickoff 100H
    lxi sp, 3FFEH

; PUSH/POP B: round-trip
    lxi b, 1234H
    push b
    lxi b, 0000H     ; clear BC
    pop b
    assert BC, 1234H

; PUSH/POP D: round-trip
    lxi d, 5678H
    push d
    lxi d, 0000H
    pop d
    assert DE, 5678H

; PUSH/POP H: round-trip
    lxi h, 9ABCH
    push h
    lxi h, 0000H
    pop h
    assert HL, 9ABCH

; SP movement: each PUSH decrements SP by 2, each POP increments
    lxi sp, 3FFEH
    assert SP, 3FFEH
    push b
    assert SP, 3FFCH
    push d
    assert SP, 3FFAH
    pop d
    assert SP, 3FFCH
    pop b
    assert SP, 3FFEH

; Stack memory layout: little-endian (low byte at lower address)
    lxi b, 0AABBH
    lxi sp, 3FFEH
    push b
    assert MEM, 3FFCH, 0BBH   ; B=BB is the low byte → [SP]
    assert MEM, 3FFDH, 0AAH   ; B=AA is the high byte → [SP+1]

; PUSH/POP PSW: saves A and flags together
    mvi a, 0F0H
    stc              ; CY=1
    push psw         ; saves A=F0H, flags (with CY=1)
    mvi a, 00H
    xra a            ; A=0, CY=0, Z=1 — overwrites flags
    pop psw          ; restore A=F0H, flags with CY=1
    assert A, 0F0H
    assert CY, 1

    hlt`,

    '16-bit Arithmetic': `; ── DAD / INX / DCX / SPHL TESTS ─────────────────────────────────
; DAD: 16-bit HL = HL + pair.  Only CY is affected.
; INX / DCX: 16-bit inc/dec.  NO flags are changed at all.
    org     100H
    kickoff 100H

; DAD B: HL = HL + BC, no carry
    lxi h, 1000H
    lxi b, 0200H
    dad b
    assert HL, 1200H
    assert CY, 0

; DAD B: carry out (overflow 16 bits)
    lxi h, 0FF00H
    lxi b, 0200H
    dad b
    assert HL, 0100H
    assert CY, 1

; DAD D
    lxi h, 2000H
    lxi d, 3000H
    dad d
    assert HL, 5000H
    assert CY, 0

; DAD H: HL = HL + HL (double HL)
    lxi h, 1000H
    dad h
    assert HL, 2000H
    assert CY, 0

; DAD SP
    lxi h, 1000H
    lxi sp, 2000H
    dad sp
    assert HL, 3000H

; INX: wraps FFFFH → 0000H, does NOT affect CY
    stc              ; CY=1 before INX
    lxi b, 0FFFFH
    inx b
    assert BC, 0000H
    assert CY, 1     ; CY must be unchanged by INX

; INX: regular increment
    lxi d, 1234H
    inx d
    assert DE, 1235H

; DCX: wraps 0000H → FFFFH
    lxi h, 0000H
    dcx h
    assert HL, 0FFFFH

; DCX: regular decrement
    lxi b, 0500H
    dcx b
    assert BC, 04FFH

; SPHL: SP = HL
    lxi h, 2000H
    sphl
    assert SP, 2000H

    hlt`,

    'DAA (BCD)': `; ── DAA — DECIMAL ADJUST ACCUMULATOR TESTS ───────────────────────
; After binary addition, DAA corrects A to a valid packed-BCD byte.
; Two decimal digits per byte: upper nibble = tens, lower = units.
    org     100H
    kickoff 100H

; 09 + 01 = BCD 10 (adjust lower nibble: 0AH → 10H)
    mvi a, 09H
    adi 01H          ; A = 0AH (invalid BCD)
    daa              ; → 10H  (BCD 10)
    assert A, 10H
    assert CY, 0

; 09 + 09 = BCD 18
    mvi a, 09H
    adi 09H          ; A = 12H, AC=1 (9+9=18, lower nibble carries)
    daa              ; → 18H  (BCD 18)
    assert A, 18H
    assert CY, 0

; 08 + 08 = BCD 16 (AC set because 8+8=16, lower nibble carry)
    mvi a, 08H
    adi 08H          ; A = 10H, AC=1
    daa              ; → 16H  (BCD 16)
    assert A, 16H
    assert CY, 0

; 47 + 35 = BCD 82
    mvi a, 47H
    adi 35H          ; A = 7CH
    daa              ; → 82H  (BCD 82)
    assert A, 82H
    assert CY, 0

; 99 + 01 = BCD 00 with carry (BCD overflow: 99+1=100)
    mvi a, 99H
    adi 01H          ; A = 9AH, no binary carry
    daa              ; → 00H, CY=1  (BCD 100)
    assert A, 00H
    assert CY, 1

; 99 + 99 = BCD 98 with carry (199 in BCD)
    mvi a, 99H
    adi 99H          ; A = 32H, binary CY=1
    daa              ; → 98H, CY=1
    assert A, 98H
    assert CY, 1

; 50 + 50 = BCD 00 with carry (100 in BCD)
    mvi a, 50H
    adi 50H          ; A = A0H
    daa              ; → 00H, CY=1
    assert A, 00H
    assert CY, 1

    hlt`,

  },

  'I/O': {
    'Port Echo': `; Read a byte from input port 01H, write it to output port 02H.
; Before running: set port 01H value in the I/O Ports panel.
    org 100H
    kickoff 100H
    in   01H            ; A = value preset on input port 01H
    out  02H            ; write A to output port 02H (visible in panel)
    hlt`,

    'Port Counter': `; Count from 0..FFH, sending each value to output port 01H.
; Watch port 01H increment in the I/O Ports panel.
    org 100H
    kickoff 100H
    mvi a, 00H
loop:
    out  01H            ; send counter value to port 01H
    inr  a
    jnz  loop           ; stop when A wraps to 0
    hlt`,

    'LED Scroll': `; Scroll digits across the LED display using Intel SDK system calls.
    org 100H
    kickoff 100H
    setbyte 511H, 00H
    setbyte 512H, 01H
    setbyte 513H, 02H
    setbyte 514H, 03H
    setbyte 515H, 04H
    setbyte 516H, 05H
    setbyte 517H, 06H
    setbyte 518H, 07H
    lxi sp, 200H
again:
    lxi h, 511H
    mvi b, 08H
loop:
    mvi  c, 0BH
    mov  d, m
    call 5              ; scroll LED left, insert D
    mvi  a, 09H
    push h
    lxi  h, 55H
    call 5              ; delay
    pop  h
    inx  h
    dcr  b
    jnz  loop
    jmp  again
    hlt`,
  },
}

// ── Helpers ─────────────────────────────────────────────────────────────
const hex2 = n => (n >>> 0 & 0xFF).toString(16).toUpperCase().padStart(2,'0')
const hex4 = n => (n >>> 0 & 0xFFFF).toString(16).toUpperCase().padStart(4,'0')

const b64encode = str => btoa(Array.from(new TextEncoder().encode(str), b => String.fromCharCode(b)).join(''))
const b64decode = b64 => { try { return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))) } catch { return null } }

const SPEEDS = [
  { label:'Crawl', steps:1    },
  { label:'Slow',  steps:20   },
  { label:'Med',   steps:200  },
  { label:'Fast',  steps:1000 },
  { label:'Turbo', steps:10000},
]

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
  // Assembler directives
  ORG:     { brief:'Set assembly origin address', flags:'—', bytes:0, cycles:'—', desc:'Moves the assembly pointer to the given address. All instructions and data after ORG are placed starting at that address. Does not emit any machine code.', ex:'ORG 0100H\nMVI A, 42H    ; assembled at 0100H' },
  KICKOFF: { brief:'Set the program entry point (start address)', flags:'—', bytes:0, cycles:'—', desc:'Tells the simulator which address to load into PC when the program is reset or first built. Unlike ORG it does not move the assembly pointer — use it once, usually before your first ORG or at the top of the file.', ex:'KICKOFF 0200H ; PC starts at 0200H\nORG 0200H\nMVI A, 01H' },
  SETBYTE: { brief:'Write a byte into memory at assembly time', flags:'—', bytes:1, cycles:'—', desc:'Writes a single 8-bit value directly into the simulator RAM at the specified address during assembly. Useful for pre-initialising data areas before the program runs.', ex:'SETBYTE 2050H, 0FFH  ; mem[2050H] = FFH' },
  SETWORD: { brief:'Write a 16-bit word into memory at assembly time (little-endian)', flags:'—', bytes:2, cycles:'—', desc:'Writes a 16-bit value into two consecutive bytes in little-endian order: low byte at addr, high byte at addr+1. Handy for pre-loading address tables or 16-bit constants.', ex:'SETWORD 2060H, 1A2BH ; mem[2060H]=2BH, mem[2061H]=1AH' },
  ASSERT:  { brief:'Simulator assertion — halt with error if value does not match', flags:'—', bytes:'3–5', cycles:'—', desc:'Simulator-only directive (encoded as opcode DDH). At runtime, compares a register, flag, register pair, or memory byte against an expected value. If they differ, execution stops immediately and the status bar shows what was expected vs. what was found. Use in test programs to verify correctness step-by-step.\n\nForms and encoded sizes:\n  ASSERT r, val      — 8-bit register B C D E H L M A  (3 bytes)\n  ASSERT f, 0|1      — flag: CY Z S P AC               (3 bytes)\n  ASSERT rp, val16   — 16-bit pair: BC DE HL SP PC     (4 bytes)\n  ASSERT MEM, addr, val — byte at memory address       (5 bytes)\n\nNot a real 8085 instruction; opcode DDH is undefined on real hardware.', ex:'ASSERT A,   42H         ; stop if A ≠ 42H\nASSERT CY,  1           ; stop if carry ≠ 1\nASSERT HL,  1234H       ; stop if HL ≠ 1234H\nASSERT MEM, 0300H, 0FFH ; stop if mem[0300H] ≠ FFH' },
}

// ── CM6 error-line decoration ─────────────────────────────────────────────
const setErrorLineEff = StateEffect.define()
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

function buildAddrLineMap(code) {
  const map = new Map()
  let pc = 0
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i].replace(/;.*$/, '').trim().toLowerCase()
    if (!text) continue
    if (text.startsWith('org ')) { pc = parseInt(text.slice(4).replace(/h$/,''), 16) || pc; continue }
    if (text.startsWith('kickoff ') || text.startsWith('setbyte ') || text.startsWith('setword ')) continue
    text = text.replace(/^[a-z_]\w*:\s*/, '')
    if (!text) continue
    map.set(pc, i + 1)
    const d = sim.simDisassemble(pc)
    pc += Math.max(1, d.len)
  }
  return map
}

function evalCondition(expr, r) {
  try {
    const BC = (r.b<<8)|r.c, DE = (r.d<<8)|r.e, HL = (r.h<<8)|r.l
    // eslint-disable-next-line no-new-func
    return !!new Function('A','B','C','D','E','H','L','PC','SP','BC','DE','HL','FLAGS',
      `return !!(${expr})`)(r.a,r.b,r.c,r.d,r.e,r.h,r.l,r.pc,r.sp,BC,DE,HL,r.flags)
  } catch { return true }
}

const TRACE_REG16 = new Set(['pc','sp'])
function fmtTraceVal(k, v) { return TRACE_REG16.has(k) ? hex4(v) : hex2(v) }

// ── Panel help descriptions ──────────────────────────────────────────────
const PANEL_HELP_TEXT = {
  'EDITOR':           'Write 8085 assembly here. ORG sets the assembly address; KICKOFF sets the entry point. Hover any mnemonic for a quick summary; Ctrl+click for full docs.',
  'INSTRUCTION HELP': 'Shows documentation for the instruction under your cursor — flags affected, byte size, cycle count, and an example. Updates as you type.',
  'LED DISPLAY':      'Simulates the Intel SDK-85 7-segment display. Drive with CALL 5: C=02H writes a digit (B=field, HL→data), C=09H/0BH scrolls left inserting D, C=03H blanks fields.',
  'DISASSEMBLY':      'Live disassembly of RAM at the current PC. Click the gutter (·) to toggle a breakpoint (●); right-click a breakpoint to add a condition. Click a row to jump the editor to that source line.',
  'AI ASSISTANT':     'Ask questions about your 8085 code. The current register state and source are included automatically. Requires your own Anthropic API key (stored in this browser only).',
  'MEMORY':           'Hex dump of all 64 KB RAM. PC cell is green, SP cell is amber. Double-click a cell to edit. Arrow keys navigate; PgUp/Dn scroll. Drag the top handle to resize the panel.',
  'REGISTERS':        'Live 8085 register values. Click any value to edit it. The base toggle (HEX/DEC/BIN) cycles the display format. Registers that changed since the last step are highlighted green.',
  'REGISTER PAIRS':   'BC, DE, and HL shown as combined 16-bit addresses, plus the byte stored at each address. Click an address to jump the memory view there; click the value to edit the pair.',
  'FLAGS':            'Current state of the five 8085 status flags: Sign (S), Zero (Z), Auxiliary Carry (AC), Parity (P), Carry (CY). Updated automatically after every arithmetic and logic instruction.',
  'STACK':            'Memory at and above SP interpreted as a stack of 16-bit values. The top entry is highlighted green. PUSH decrements SP by 2; POP increments it.',
  'TRACE':            'Last 50 instructions executed in order. Each row shows the address, disassembled text, and any registers that changed (green). Cleared on every Build. Step to populate it.',
  'WATCH':            'Monitor registers or memory addresses in real time. Type a name (A, BC, HL…) or a hex address (0200H) and press Enter or +. Values update after each step.',
  'CALCULATOR':       'Convert 16-bit values between binary, octal, decimal, and hex. Type in any field and the others update instantly — handy for working out immediate operands.',
  'I/O PORTS':        'Shows ports written by OUT instructions (output) and lets you preset values that IN will read (input). Input presets survive a Build; output clears on each Build.',
  'SYMBOLS':          'Labels defined in your source code and their resolved addresses after a successful Build. Click a row to jump the memory view to that address.',
}

function PanelHelp({ panel }) {
  const [show, setShow] = useState(false)
  const wrapRef = useRef(null)
  const text = PANEL_HELP_TEXT[panel]
  useEffect(() => {
    if (!show) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setShow(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [show])
  useEffect(() => {
    if (!show) return
    const h = e => { if (e.key === 'Escape') setShow(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [show])
  if (!text) return null
  return (
    <div className="panel-help-wrap" ref={wrapRef}>
      <button className="panel-help-btn" onClick={() => setShow(o => !o)} title="Panel help">?</button>
      {show && <div className="panel-help-popup">{text}</div>}
    </div>
  )
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
    <svg width="33" height="48" viewBox="0 0 17 23">
      {segs.map(s => <path key={s.id} d={s.d} fill={value & s.bit ? ON : OFF} />)}
    </svg>
  )
}

// ── CodeMirror editor ────────────────────────────────────────────────────
function AsmEditor({ value, onChange, onCursorInstruction, onInstructionDetail, errorLine, gotoRef }) {
  const elRef    = useRef(null)
  const viewRef  = useRef(null)
  const syncing  = useRef(false)
  const cursorCb = useRef(onCursorInstruction)
  const detailCb = useRef(onInstructionDetail)
  useEffect(() => { cursorCb.current = onCursorInstruction }, [onCursorInstruction])
  useEffect(() => { detailCb.current = onInstructionDetail }, [onInstructionDetail])

  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({ effects: setErrorLineEff.of(errorLine ?? null) })
  }, [errorLine])

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
          errorLineField,
          EditorView.theme({
            '&': { height:'100%', fontFamily:'"JetBrains Mono","Fira Code",monospace', fontSize:'15px' },
            '.cm-scroller': { overflow:'auto' },
            '.cm-content': { padding:'8px 0', minHeight:'100%' },
            '.cm-error-line': { background: 'rgba(255,60,60,0.18)' },
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
            }
          }),
        ],
      }),
      parent: elRef.current,
    })
    viewRef.current = view
    if (gotoRef) gotoRef.current = (lineNum, labelName) => {
      try {
        if (labelName) {
          const text = view.state.doc.toString()
          const escaped = labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const m = new RegExp(`(^|\\n)[\\t ]*(${escaped})[\\t ]*:`, 'im').exec(text)
          if (m) {
            const nameIdx = m.index + m[0].indexOf(m[2])
            view.dispatch({ selection: { anchor: nameIdx, head: nameIdx + m[2].length }, effects: EditorView.scrollIntoView(nameIdx, { y: 'center' }) })
            return
          }
        }
        const line = view.state.doc.line(lineNum)
        view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
      } catch {}
    }
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
function fmtByte(v, base) {
  if (base === 'dec') return String(v)
  if (base === 'bin') return v.toString(2).padStart(8, '0')
  return hex2(v)
}
function fmtWord(v, base) {
  if (base === 'dec') return String(v)
  if (base === 'bin') return v.toString(2).padStart(16, '0')
  return hex4(v)
}
const BASE_CYCLE = ['hex', 'dec', 'bin']

function RegPanel({ regs, prev, onJump, regBase, onRegBase, onEdit }) {
  const p = prev || {}

  function EditableRow({ name, val, prevVal, regKey, is16 }) {
    const [editing, setEditing] = useState(false)
    const [buf, setBuf] = useState('')
    const changed = prevVal !== undefined && val !== prevVal

    function commit() {
      const radix = regBase === 'bin' ? 2 : regBase === 'dec' ? 10 : 16
      const n = parseInt(buf, radix)
      if (!isNaN(n)) {
        if (regKey === 'pc' && !window.confirm(`Move instruction pointer to ${hex4(n)}H?\nThe next step will execute from that address.`)) { setEditing(false); return }
        sim.simSetRegisters({ [regKey]: n })
        onEdit()
      }
      setEditing(false)
    }

    if (editing) return (
      <div className={`reg-row${is16 ? ' wide' : ''}${changed ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <input autoFocus className="reg-edit-input"
          value={buf} onChange={e => setBuf(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
      </div>
    )
    return (
      <div className={`reg-row${is16 ? ' wide clickable' : ' clickable'}${changed ? ' changed' : ''}`}
           title={is16 ? `Jump memory to ${hex4(val)}H  (click to edit)` : 'Click to edit'}
           onClick={() => {
             if (is16) onJump(val & 0xFFF0)
             setBuf(is16 ? fmtWord(val, regBase) : fmtByte(val, regBase))
             setEditing(true)
           }}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{is16 ? fmtWord(val, regBase) : fmtByte(val, regBase)}</span>
        {regBase === 'hex' && !is16 && <span className="reg-dec">{val}</span>}
        {regBase === 'hex' &&  is16 && <span className="reg-dec">{val}</span>}
      </div>
    )
  }

  // Paired cell: two 8-bit registers side-by-side
  function PairCell({ name, val, prevVal, regKey }) {
    const [editing, setEditing] = useState(false)
    const [buf, setBuf] = useState('')
    const changed = prevVal !== undefined && val !== prevVal

    function commit() {
      const radix = regBase === 'bin' ? 2 : regBase === 'dec' ? 10 : 16
      const n = parseInt(buf, radix)
      if (!isNaN(n)) { sim.simSetRegisters({ [regKey]: n }); onEdit() }
      setEditing(false)
    }

    if (editing) return (
      <div className={`reg-pair-cell${changed ? ' changed' : ''}`}>
        <span className="reg-name">{name}</span>
        <input autoFocus className="reg-edit-input reg-pair-input"
          value={buf} onChange={e => setBuf(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
      </div>
    )
    return (
      <div className={`reg-pair-cell clickable${changed ? ' changed' : ''}`}
           title="Click to edit"
           onClick={() => { setBuf(fmtByte(val, regBase)); setEditing(true) }}>
        <span className="reg-name">{name}</span>
        <span className="reg-hex">{fmtByte(val, regBase)}</span>
        {regBase === 'hex' && <span className="reg-dec">{val}</span>}
      </div>
    )
  }

  const nextBase = BASE_CYCLE[(BASE_CYCLE.indexOf(regBase) + 1) % 3]

  return (
    <div className="panel reg-panel">
      <div className="panel-hd">
        <span className="panel-icon">🧠</span>REGISTERS
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => onRegBase(nextBase)}
            title="Toggle display: hex / dec / bin">{regBase.toUpperCase()}</button>
          <PanelHelp panel="REGISTERS" />
        </div>
      </div>
      <EditableRow name="A" val={regs.a} prevVal={p.a} regKey="a" />
      <div className="reg-bits">
        {[7,6,5,4,3,2,1,0].map(bit => (
          <div key={bit} className={`reg-bit${(regs.a>>bit)&1 ? ' reg-bit-on' : ''}`}
               title={`bit ${bit} — click to toggle`}
               onClick={() => { const v = regs.a ^ (1<<bit); sim.simSetRegisters({a:v}); onEdit() }}>
            <div className="reg-bit-lbl">{bit}</div>
            <div className="reg-bit-val">{(regs.a>>bit)&1}</div>
          </div>
        ))}
      </div>
      <div className="reg-pair-row">
        <PairCell name="B" val={regs.b} prevVal={p.b} regKey="b" />
        <PairCell name="C" val={regs.c} prevVal={p.c} regKey="c" />
      </div>
      <div className="reg-pair-row">
        <PairCell name="D" val={regs.d} prevVal={p.d} regKey="d" />
        <PairCell name="E" val={regs.e} prevVal={p.e} regKey="e" />
      </div>
      <div className="reg-pair-row">
        <PairCell name="H" val={regs.h} prevVal={p.h} regKey="h" />
        <PairCell name="L" val={regs.l} prevVal={p.l} regKey="l" />
      </div>
      <div className="reg-sep" />
      <EditableRow name="PC" val={regs.pc} prevVal={p.pc} regKey="pc" is16 />
      <EditableRow name="SP" val={regs.sp} prevVal={p.sp} regKey="sp" is16 />
    </div>
  )
}

// ── Register pairs panel ─────────────────────────────────────────────────
const PAIR_DEFS = [
  { name: 'BC', hi: 'b', lo: 'c' },
  { name: 'DE', hi: 'd', lo: 'e' },
  { name: 'HL', hi: 'h', lo: 'l' },
]

function PairPanel({ regs, prev, onJump, onEdit, regBase, onRegBase }) {
  const [editing, setEditing] = useState(null)  // { key, field: 'addr'|'content' }
  const [buf, setBuf] = useState('')
  const p = prev || {}

  function startEdit(key, field, initial) {
    setEditing({ key, field })
    setBuf(initial)
  }

  function commitEdit() {
    if (!editing) return
    const { key, field } = editing
    const def = PAIR_DEFS.find(d => d.name === key)
    if (!def) { setEditing(null); return }
    const addr = (regs[def.hi] << 8) | regs[def.lo]
    const n = parseInt(buf, 16)
    if (!isNaN(n)) {
      if (field === 'addr') {
        sim.simSetRegisters({ [def.hi]: (n >> 8) & 0xFF, [def.lo]: n & 0xFF })
      } else {
        sim.simWriteByte(addr, n & 0xFF)
      }
      onEdit()
    }
    setEditing(null)
  }

  return (
    <div className="panel reg-panel">
      <div className="panel-hd">
        <span className="panel-icon">🔗</span>REGISTER PAIRS
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="REGISTER PAIRS" />
        </div>
      </div>
      <div className="pair-col-hdr">
        <span />
        <span>ADDR</span>
        <span>CONTENT</span>
      </div>
      {PAIR_DEFS.map(({ name, hi, lo }) => {
        const val     = (regs[hi] << 8) | regs[lo]
        const prevVal = p[hi] !== undefined ? (p[hi] << 8) | p[lo] : undefined
        const mem     = sim.simGetMemory(val, 1)[0] ?? 0
        const changed = prevVal !== undefined && val !== prevVal
        const editAddr    = editing?.key === name && editing?.field === 'addr'
        const editContent = editing?.key === name && editing?.field === 'content'
        return (
          <div key={name} className={`pair-row${changed ? ' changed' : ''}`}>
            <span className="reg-name">{name}</span>
            {editAddr
              ? <input autoFocus className="reg-edit-input pair-edit-input" value={buf}
                  onChange={e => setBuf(e.target.value.toUpperCase())}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key==='Enter') commitEdit(); if (e.key==='Escape') setEditing(null) }} />
              : <span className="pair-addr"
                  onClick={() => { onJump(val & 0xFFF0); startEdit(name, 'addr', hex4(val)) }}
                  title={`${hex4(val)}H — click to edit pair address, jump memory`}>
                  {fmtWord(val, regBase)}
                </span>
            }
            {editContent
              ? <input autoFocus className="reg-edit-input pair-edit-input" value={buf}
                  onChange={e => setBuf(e.target.value.toUpperCase())}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key==='Enter') commitEdit(); if (e.key==='Escape') setEditing(null) }} />
              : <span className="pair-content"
                  onClick={() => startEdit(name, 'content', hex2(mem))}
                  title={`mem[${hex4(val)}H] = ${hex2(mem)}H — click to edit`}>
                  {fmtByte(mem, regBase)}
                </span>
            }
          </div>
        )
      })}
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
      <div className="panel-hd"><span className="panel-icon">🚩</span>FLAGS<PanelHelp panel="FLAGS" /></div>
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
function DisasmPanel({ regs, breakpoints, onToggleBp, onSetCondition, onGotoLine, buildId, onRunTo, jumpRef, symbols, onJumpMem }) {
  const [viewStart, setViewStart] = useState(() => regs.pc)
  const [ctxMenu, setCtxMenu] = useState(null)  // {addr, x, y}
  const curRowRef = useRef(null)

  useEffect(() => { if (jumpRef) jumpRef.current = setViewStart }, [jumpRef])

  const addrToLabel = useMemo(() => {
    const m = new Map()
    for (const [name, addr] of Object.entries(symbols || {})) m.set(addr, name)
    return m
  }, [symbols])

  const lines = useMemo(() => {
    const out = []
    let addr = viewStart
    for (let i = 0; i < 100 && addr < 0x4000; i++) {
      const d = sim.simDisassemble(addr)
      out.push({ addr, ...d })
      addr += Math.max(1, d.len)
    }
    return out
  }, [viewStart, buildId])

  const hoveredRef  = useRef(false)
  const linesRef    = useRef(lines)
  const addrIdxRef  = useRef([])  // complete instruction address table, rebuilt on each build
  useEffect(() => { linesRef.current = lines }, [lines])

  // Build a complete address index by scanning all memory from 0 on each build.
  // Uninitialized RAM is 0x00 (NOP, 1 byte) so alignment from address 0 is always correct.
  useEffect(() => {
    const idx = []
    let addr = 0
    while (addr <= 0x3FFF) { idx.push(addr); const d = sim.simDisassemble(addr); addr += Math.max(1, d.len) }
    addrIdxRef.current = idx
  }, [buildId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Binary search: largest table index whose address value <= addr
  const findIdx = useCallback((addr) => {
    const idx = addrIdxRef.current
    let lo = 0, hi = idx.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (idx[mid] <= addr) lo = mid; else hi = mid - 1 }
    return lo
  }, [])

  useEffect(() => { setViewStart(regs.pc) }, [buildId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ls = linesRef.current
    if (!ls.length) return
    const lo = ls[0].addr
    const hi = ls[ls.length - 1].addr
    if (regs.pc >= lo && regs.pc <= hi) {
      curRowRef.current?.scrollIntoView({ block: 'nearest' })
    } else if (regs.pc > hi && regs.pc - hi <= 6) {
      // PC just stepped past the bottom — advance one instruction at a time
      setViewStart(vs => { const i = findIdx(vs); return addrIdxRef.current[Math.min(addrIdxRef.current.length - 1, i + 1)] })
    } else {
      setViewStart(regs.pc)
    }
  }, [regs.pc]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

  useEffect(() => {
    const handler = (e) => {
      if (!hoveredRef.current) return
      const ls = linesRef.current
      const idx = addrIdxRef.current
      const step = (vs, delta) => {
        const i = findIdx(vs)
        return idx[Math.max(0, Math.min(idx.length - 1, i + delta))]
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setViewStart(vs => step(vs, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setViewStart(vs => step(vs, -1))
      } else if (e.key === 'PageDown') {
        e.preventDefault(); setViewStart(vs => step(vs, Math.max(1, Math.floor(ls.length * 0.75))))
      } else if (e.key === 'PageUp') {
        e.preventDefault(); setViewStart(vs => step(vs, -Math.max(1, Math.floor(ls.length * 0.75))))
      } else if (e.key === 'Home') {
        e.preventDefault(); setViewStart(0)
      } else if (e.key === 'End') {
        e.preventDefault(); setViewStart(0x3F00)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="panel disasm-panel">
      <div className="panel-hd"><span className="panel-icon">📋</span>DISASSEMBLY<PanelHelp panel="DISASSEMBLY" /></div>
      <div className="disasm-list"
        onMouseEnter={() => { hoveredRef.current = true }}
        onMouseLeave={() => { hoveredRef.current = false }}>
        {lines.map(row => {
          const cur   = row.addr === regs.pc
          const bp    = breakpoints.has(row.addr)
          const cond  = breakpoints.get(row.addr) ?? null
          const label = addrToLabel.get(row.addr)
          return (
            <div key={row.addr}>
            {label && (
              <div className="disasm-label"
                onClick={() => { onJumpMem?.(row.addr & 0xFFF0); onGotoLine?.(row.addr, label) }}
                title={`${label}: at ${hex4(row.addr)}H — click to jump memory + editor`}>
                {label}:
              </div>
            )}
            <div
              ref={cur ? curRowRef : null}
              className={`disasm-row${cur ? ' cur' : ''}${bp ? ' bp' : ''}${row.mnem === 'ASSERT' ? ' assert' : ''}`}
              onClick={() => onGotoLine?.(row.addr)}
              onContextMenu={e => { e.preventDefault(); setCtxMenu({ addr: row.addr, x: e.clientX, y: e.clientY }) }}
            >
              <span className="disasm-bp"
                title={bp ? (cond ? `Condition: ${cond} — right-click to edit` : 'Breakpoint — right-click to add condition') : 'Click to set breakpoint'}
                onClick={e => { e.stopPropagation(); onToggleBp(row.addr) }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); bp && onSetCondition?.(row.addr) }}
              >
                {bp ? (cond ? '◆' : '●') : '·'}
              </span>
              <span className="disasm-text">{row.text}</span>
              {cond && bp && <span className="disasm-cond">{cond}</span>}
              {cur && <span className="disasm-pc-arrow">◀</span>}
            </div>
            </div>
          )
        })}
      </div>
      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}>
          <button className="ctx-menu-item" onClick={() => { onRunTo?.(ctxMenu.addr); setCtxMenu(null) }}>
            ▶ Run to {hex4(ctxMenu.addr)}H
          </button>
          <button className="ctx-menu-item" onClick={() => { onToggleBp(ctxMenu.addr); setCtxMenu(null) }}>
            {breakpoints.has(ctxMenu.addr) ? '○ Remove BP' : '● Set BP'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Memory dump panel ────────────────────────────────────────────────────
function MemPanel({ memStart, onJump, regs, buildId, changedAddrs, programRegion, presetAddrs }) {
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
        <span className="panel-icon">💾</span>MEMORY
        <div className="panel-hd-right">
        <span className="mem-ctrl">
          <button className="mem-btn" title="Back 4 pages" onClick={() => onJump(Math.max(0, memStart - COLS*rows*4))}>«</button>
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
          <button className="mem-btn" title="Forward 4 pages" onClick={() => onJump(Math.min(0x3F00, memStart + COLS*rows*4))}>»</button>
        </span>
        <PanelHelp panel="MEMORY" />
        </div>
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
                    const isCode   = !isPC && !isSP && programRegion && addr >= programRegion.start && addr < programRegion.end
                    const isPreset = !isPC && !isSP && !isCode && presetAddrs?.has(addr)
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
                        className={`mem-cell${isPC?' mem-pc':''}${isSP?' mem-sp':''}${isCode?' mem-code':''}${isPreset?' mem-preset':''}${isCursor?' mem-cursor':''}${val?' mem-nz':''}${changedAddrs?.has(addr)?' mem-diff':''}`}
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
        <span className="legend-code">■</span> Code &nbsp;
        <span className="legend-preset">■</span> Data &nbsp;
        <span className="legend-tip">double-click to edit · click + ↑↓ PgUp/Dn to scroll</span>
      </div>
    </div>
  )
}

// ── Calculator panel ─────────────────────────────────────────────────────
const CALC_BASES = [
  { key: 'bin', label: 'BIN', radix:  2, maxLen: 16, placeholder: '1111111111111111' },
  { key: 'oct', label: 'OCT', radix:  8, maxLen:  6, placeholder: '177777' },
  { key: 'dec', label: 'DEC', radix: 10, maxLen:  5, placeholder: '65535' },
  { key: 'hex', label: 'HEX', radix: 16, maxLen:  4, placeholder: 'FFFF' },
]
const EMPTY_VALS = { bin: '', oct: '', dec: '', hex: '' }

function CalcFloat({ onClose }) {
  const [vals, setVals] = useState(EMPTY_VALS)
  const [pos,  setPos]  = useState({ x: Math.max(0, window.innerWidth / 2 - 120), y: 100 })
  const posRef = useRef(pos)

  function update(key, raw) {
    const { radix } = CALC_BASES.find(b => b.key === key)
    const input = key === 'hex' ? raw.toUpperCase() : raw
    if (input === '') { setVals(EMPTY_VALS); return }
    const n = parseInt(input, radix)
    if (isNaN(n) || n < 0 || n > 0xFFFF) { setVals(v => ({ ...v, [key]: input })); return }
    setVals({ bin: n.toString(2), oct: n.toString(8), dec: String(n), hex: n.toString(16).toUpperCase(), [key]: input })
  }

  function onDragDown(e) {
    if (e.target.closest('button')) return
    e.preventDefault()
    const ox = e.clientX - posRef.current.x, oy = e.clientY - posRef.current.y
    function onMove(ev) {
      const p = { x: ev.clientX - ox, y: Math.max(0, ev.clientY - oy) }
      posRef.current = p; setPos(p)
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="calc-float" style={{ left: pos.x, top: pos.y }}>
      <div className="calc-float-hd" onMouseDown={onDragDown}>
        <span><span className="panel-icon">🖩</span>CALCULATOR</span>
        <button className="calc-float-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="calc-body">
        {CALC_BASES.map(({ key, label, maxLen, placeholder }) => (
          <div key={key} className="calc-row">
            <span className="calc-lbl">{label}</span>
            <input className="calc-input" value={vals[key]} maxLength={maxLen}
              placeholder={placeholder} spellCheck={false}
              onChange={e => update(key, e.target.value)}
              onFocus={e => e.target.select()} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── AI chat panel ────────────────────────────────────────────────────────
const CHAT_SYSTEM = `You are an expert assistant embedded in an Intel 8085 microprocessor simulator. Help users with 8085 assembly language programming, instruction behaviour, register and flag effects, debugging, memory addressing, and general computer architecture. When showing code use 8085 assembly syntax. Be concise and practical.`

function ChatPanel({ regs, src }) {
  const [apiKey,      setApiKey]      = useState(() => localStorage.getItem('ant_key') || '')
  const [keyDraft,    setKeyDraft]    = useState('')
  const [setupOpen,   setSetupOpen]   = useState(!localStorage.getItem('ant_key'))
  const [messages,    setMessages]    = useState([])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const scrollRef  = useRef(null)
  const inputRef   = useRef(null)
  const panelRef   = useRef(null)

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
          model: 'claude-haiku-4-5-20251001',
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

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY, startH = panelRef.current.getBoundingClientRect().height
    const onMove = ev => { panelRef.current.style.height = Math.max(80, startH + (startY - ev.clientY)) + 'px' }
    const onUp   = ()  => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel chat-panel" ref={panelRef}>
      <div className="chat-resize-handle" onMouseDown={onResizeDown} />
      <div className="panel-hd">
        <span className="panel-icon">🤖</span>AI ASSISTANT
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => setSetupOpen(o => !o)} title="API key settings">⚙</button>
          <PanelHelp panel="AI ASSISTANT" />
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
            <div className="chat-bubble">{m.content}</div>
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

// ── Stack panel ──────────────────────────────────────────────────────────
function StackPanel({ regs, regBase, onRegBase }) {
  const panelRef = useRef(null)
  const entries = useMemo(() => {
    const out = []
    for (let i = 0; i < 64; i++) {
      const a = (regs.sp + i*2) & 0xFFFF
      if (a >= 0x4000) break
      out.push({ addr: a, val: sim.simReadByte(a) | (sim.simReadByte(a+1)<<8) })
    }
    return out
  }, [regs.sp])

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY, startH = panelRef.current.getBoundingClientRect().height
    const onMove = ev => { panelRef.current.style.height = Math.max(72, startH + (ev.clientY - startY)) + 'px' }
    const onUp   = ()  => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel stack-panel" ref={panelRef}>
      <div className="panel-hd">
        <span className="panel-icon">📚</span>STACK
        <div className="panel-hd-right">
          <code className="sp-val">SP={hex4(regs.sp)}</code>
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="STACK" />
        </div>
      </div>
      <div className="stack-body">
        {entries.length === 0
          ? <div className="stack-empty">empty</div>
          : entries.map((e,i) => (
            <div key={e.addr} className={`stack-row${i===0?' stack-top':''}`}>
              <span className="stack-addr">{hex4(e.addr)}</span>
              <span className="stack-sep">→</span>
              <span className="stack-val">{fmtWord(e.val, regBase)}</span>
            </div>
          ))
        }
      </div>
      <div className="stack-resize-handle" onMouseDown={onResizeDown} />
    </div>
  )
}

// ── LED display ──────────────────────────────────────────────────────────
function LedDisplay({ leds }) {
  const LABELS = ['ST1','ST0','A3','A2','A1','A0','D1','D0']
  return (
    <div className="panel led-panel">
      <div className="panel-hd"><span className="panel-icon">💡</span>LED DISPLAY<PanelHelp panel="LED DISPLAY" /></div>
      <div className="led-digits">
        {leds.map((v,i) => (
          <div key={i} className={`led-digit${i < 2 ? ' led-digit-st' : ''}`}>
            <SevenSeg value={v} />
            <div className="led-val">{v.toString(16).toUpperCase().padStart(2,'0')}</div>
            <div className="led-lbl">{LABELS[i]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Execution trace panel ────────────────────────────────────────────────
function TracePanel({ trace, onClear }) {
  const bodyRef = useRef(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [trace])

  return (
    <div className="panel trace-panel">
      <div className="panel-hd">
        <span className="panel-icon">📜</span>TRACE
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={onClear} title="Clear trace">✕</button>
          <PanelHelp panel="TRACE" />
        </div>
      </div>
      <div className="trace-body" ref={bodyRef}>
        {trace.length === 0
          ? <div className="trace-empty">Step or run to record execution</div>
          : trace.map((e, i) => (
            <div key={i} className="trace-row">
              <span className="trace-addr">{hex4(e.addr)}</span>
              <span className="trace-text">{e.text.replace(/^[0-9A-Fa-f]{4}\s+(?:[0-9A-Fa-f]{2}\s+)+/, '').trim()}</span>
              {e.changedKeys.length > 0 &&
                <span className="trace-delta">
                  {e.changedKeys.map(k => {
                    const FLAG_SHORT = { flagS:'S', flagZ:'Z', flagAC:'AC', flagP:'P', flagCY:'CY' }
                    const name = FLAG_SHORT[k] ?? k.toUpperCase()
                    const val  = FLAG_SHORT[k] ? e.regs[k] : fmtTraceVal(k, e.regs[k])
                    return `${name}=${val}`
                  }).join(' ')}
                </span>
              }
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── Watch panel ──────────────────────────────────────────────────────────
function WatchPanel({ watches, regs, onAdd, onRemove, regBase, onRegBase }) {
  const [input, setInput] = useState('')
  const PAIR_KEYS = { bc: ['b','c'], de: ['d','e'], hl: ['h','l'] }
  const REG_NAMES = new Set(['a','b','c','d','e','h','l','pc','sp','flags','bc','de','hl'])

  function getValue(w) {
    if (w.type === 'reg') {
      const p = PAIR_KEYS[w.key]
      if (p) return (regs[p[0]] << 8) | regs[p[1]]
      return regs[w.key] ?? 0
    }
    return sim.simReadByte(w.addr)
  }

  function is16(w) {
    return w.type === 'mem' || ['pc','sp','bc','de','hl'].includes(w.key)
  }

  function addWatch() {
    const s = input.trim().toLowerCase()
    if (!s) return
    if (REG_NAMES.has(s)) {
      if (!watches.find(w => w.type === 'reg' && w.key === s))
        onAdd({ type: 'reg', key: s })
    } else {
      const addr = parseInt(s.replace(/h$/,''), 16)
      if (!isNaN(addr))
        onAdd({ type: 'mem', addr: addr & 0xFFFF })
    }
    setInput('')
  }

  return (
    <div className="panel watch-panel">
      <div className="panel-hd">
        <span className="panel-icon">👁</span>WATCH
        <div className="panel-hd-right">
          <button className="reg-base-btn" onClick={() => onRegBase(BASE_CYCLE[(BASE_CYCLE.indexOf(regBase)+1)%3])}
            title="Toggle display: hex / dec / bin">{(regBase||'hex').toUpperCase()}</button>
          <PanelHelp panel="WATCH" />
        </div>
      </div>
      <div className="watch-add-row">
        <input className="watch-input" value={input} placeholder="A  BC  0200H…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addWatch()} />
        <button className="btn btn-xs" onClick={addWatch}>+</button>
      </div>
      <div className="watch-body">
        {watches.length === 0
          ? <div className="watch-empty">Type a register or address above</div>
          : watches.map((w, i) => {
              const v = getValue(w)
              const label = w.type === 'reg' ? w.key.toUpperCase() : hex4(w.addr) + 'H'
              return (
                <div key={i} className="watch-row">
                  <span className="watch-label">{label}</span>
                  <span className="watch-val">{is16(w) ? fmtWord(v, regBase) : fmtByte(v, regBase)}</span>
                  {(regBase||'hex') === 'hex' && <span className="watch-dec">{v}</span>}
                  <button className="watch-rm" onClick={() => onRemove(i)}>✕</button>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}

// ── I/O port panel ───────────────────────────────────────────────────────
function IOPortPanel({ outputPorts, inputPresets, onSetInput, onRemoveInput }) {
  const [portBuf, setPortBuf] = useState('')
  const [valBuf,  setValBuf]  = useState('')

  function addPreset() {
    const port = parseInt(portBuf.replace(/h$/i,''), 16)
    const val  = parseInt(valBuf.replace(/h$/i,''), 16)
    if (isNaN(port) || port < 0 || port > 255) return
    onSetInput(port & 0xFF, isNaN(val) ? 0 : val & 0xFF)
    setPortBuf(''); setValBuf('')
  }

  return (
    <div className="panel ioport-panel">
      <div className="panel-hd"><span className="panel-icon">🔌</span>I/O PORTS<PanelHelp panel="I/O PORTS" /></div>

      <div className="ioport-section-hd">OUTPUT  <span className="ioport-hint">written by OUT</span></div>
      {outputPorts.length === 0
        ? <div className="ioport-empty">No OUT executed yet</div>
        : outputPorts.map(({ port, val }) => (
          <div key={port} className="ioport-row">
            <span className="ioport-port">{hex2(port)}H</span>
            <span className="ioport-arrow">→</span>
            <span className="ioport-val">{hex2(val)}H</span>
            <span className="ioport-dec">{val}</span>
          </div>
        ))
      }

      <div className="ioport-section-hd" style={{marginTop:'6px'}}>INPUT  <span className="ioport-hint">returned by IN</span></div>
      <div className="ioport-add-row">
        <input className="ioport-input" placeholder="port (hex)" value={portBuf}
          onChange={e => setPortBuf(e.target.value.toUpperCase())}
          onKeyDown={e => e.key==='Enter' && addPreset()} maxLength={3} />
        <input className="ioport-input" placeholder="value" value={valBuf}
          onChange={e => setValBuf(e.target.value.toUpperCase())}
          onKeyDown={e => e.key==='Enter' && addPreset()} maxLength={3} />
        <button className="btn btn-xs" onClick={addPreset}>+</button>
      </div>
      {inputPresets.length === 0
        ? <div className="ioport-empty">No input ports set</div>
        : inputPresets.map(({ port, val }) => (
          <div key={port} className="ioport-row">
            <span className="ioport-port">{hex2(port)}H</span>
            <span className="ioport-arrow">←</span>
            <span className="ioport-val">{hex2(val)}H</span>
            <span className="ioport-dec">{val}</span>
            <button className="watch-rm" onClick={() => onRemoveInput(port)}>✕</button>
          </div>
        ))
      }
    </div>
  )
}

// ── Example submenu ──────────────────────────────────────────────────────
function ExampleMenu({ onLoad }) {
  const [open, setOpen]         = useState(false)
  const [activeCat, setActiveCat] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => { if (!wrapRef.current?.contains(e.target)) { setOpen(false); setActiveCat(null) } }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="exmenu-wrap" ref={wrapRef}>
      <button className="btn exmenu-trigger" onClick={() => setOpen(o => !o)}>
        Examples <span className="exmenu-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="exmenu-dropdown">
          {Object.entries(EXAMPLES).map(([cat, programs]) => (
            <div key={cat}
              className={`exmenu-cat${activeCat === cat ? ' exmenu-cat-active' : ''}`}
              onMouseEnter={() => setActiveCat(cat)}
            >
              <span>{cat}</span>
              <span className="exmenu-arrow">▶</span>
              {activeCat === cat && (
                <div className="exmenu-sub">
                  {Object.keys(programs).map(name => (
                    <button key={name} className="exmenu-sub-item"
                      onClick={() => { onLoad(`${cat}::${name}`); setOpen(false); setActiveCat(null) }}>
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Brand menu ───────────────────────────────────────────────────────────
function BrandMenu({ onShowWelcome, onImport, onExport, onShare, onCalc }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function item(label, action) {
    return (
      <button className="bmenu-item" onClick={() => { action(); setOpen(false) }}>
        {label}
      </button>
    )
  }

  return (
    <div className="bmenu-wrap" ref={wrapRef}>
      <button className="brand-chip bmenu-trigger" onClick={() => setOpen(o => !o)} title="Menu">
        8085 <span className="brand-chevron">☰</span>
      </button>
      {open && (
        <div className="bmenu-dropdown">
          {item('⇡  Import .asm / .85', onImport)}
          {item('⇣  Export .asm', onExport)}
          {item('⎘  Copy share link', onShare)}
          <div className="bmenu-sep" />
          {item('🖩  Calculator', onCalc)}
          {item('📖  Welcome guide', onShowWelcome)}
          {item('⭐  View on GitHub', () => window.open('https://github.com/selfmodify/sim8085wasm', '_blank'))}
          <div className="bmenu-sep" />
          <div className="bmenu-credits">
            <div>8085 Simulator</div>
            <div>Original: V. Kumar · 1995</div>
            <div>Web port: 2026</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Welcome modal ────────────────────────────────────────────────────────
const WELCOME_FEATURES = [
  { icon: '✏️', title: 'Editor',        desc: 'Write 8085 assembly on the left. Hover any instruction for inline help, Ctrl+click for full details.' },
  { icon: '▶',  title: 'Assemble & Run', desc: 'F5 assembles, F7 steps one instruction, F9 runs/pauses. Use the speed slider to control execution pace.' },
  { icon: '📋', title: 'Disassembly',   desc: 'The center column shows the assembled code. Click the gutter to set breakpoints; execution pauses there.' },
  { icon: '🧠', title: 'CPU State',     desc: 'Registers, flags, and register pairs update live. Click a pair to jump memory to its address. Values are editable.' },
  { icon: '💾', title: 'Memory',        desc: 'Browse and edit all 64 KB of RAM. Use the address bar or ◀▶ buttons to navigate. Drag the top handle to resize.' },
  { icon: '💡', title: 'LED Display',   desc: 'Load the "LED Scroll" example from the toolbar to see the 7-segment display animate in real time.' },
  { icon: '🖩', title: 'Calculator',    desc: 'Convert values between binary, octal, decimal, and hex — handy when working with immediate operands.' },
  { icon: '🤖', title: 'AI Assistant',  desc: 'Enter your Anthropic API key (stored only in your browser) to ask questions about 8085 assembly.' },
]

function WelcomeModal({ onClose }) {
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
            <div className="brand-chip" style={{fontSize:'18px',width:'44px',height:'44px'}}>8085</div>
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
          <span className="welcome-tip">💡 Load an example from the toolbar to get started quickly.</span>
          <button className="btn welcome-btn" onClick={onClose}>Got it, let's go →</button>
        </div>
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

// ── Inline instruction help panel ────────────────────────────────────────
function HelpPanel({ instruction }) {
  const panelRef = useRef(null)
  const inst = instruction ? INST_HELP[instruction] : null

  function onResizeDown(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelRef.current.getBoundingClientRect().height
    function onMove(ev) {
      panelRef.current.style.height = Math.max(60, startH + (startY - ev.clientY)) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel help-panel" ref={panelRef}>
      <div className="help-resize-handle" onMouseDown={onResizeDown} />
      <div className="panel-hd"><span className="panel-icon">📖</span>INSTRUCTION HELP<PanelHelp panel="INSTRUCTION HELP" /></div>
      <div className="help-scroll">
        {inst ? (
          <div className="help-inline-body">
            <div className="help-inline-hd">
              <span className="help-mnem help-mnem-sm">{instruction}</span>
              <span className="help-brief">{inst.brief}</span>
            </div>
            <div className="help-meta">
              <span><span className="help-lbl">Flags</span>{inst.flags}</span>
              <span><span className="help-lbl">Size</span>{inst.bytes} byte{inst.bytes !== 1 ? 's' : ''}</span>
              <span><span className="help-lbl">Cycles</span>{inst.cycles}</span>
            </div>
            <p className="help-desc">{inst.desc}</p>
            <pre className="help-ex">{inst.ex}</pre>
          </div>
        ) : (
          <div className="help-empty">Hover over an instruction for details</div>
        )}
      </div>
    </div>
  )
}

// ── Root app ─────────────────────────────────────────────────────────────
export default function App() {
  const [src, setSrc]           = useState(() => {
    try {
      const hash = location.hash
      if (hash.startsWith('#code=')) { const d = b64decode(hash.slice(6)); if (d) return d }
      const saved = localStorage.getItem('sim8085_program')
      if (saved) return saved
    } catch {}
    return EXAMPLES['I/O']['LED Scroll']
  })
  const [regs, setRegs]         = useState({a:0,b:0,c:0,d:0,e:0,h:0,l:0,flags:0,pc:0x100,sp:0,flagS:0,flagZ:0,flagAC:0,flagP:0,flagCY:0,halted:false,hasError:false})
  const [prevRegs, setPrev]     = useState(null)
  const [leds, setLeds]         = useState(Array(8).fill(0))
  const [bps, setBps]           = useState(new Map())   // Map<addr, string|null>
  const [trace, setTrace]       = useState([])
  const [changedAddrs, setChangedAddrs] = useState(new Set())
  const [watches, setWatches]   = useState([])
  const [outputPorts, setOutputPorts] = useState([])      // [{port,val}] written by OUT
  const [inputPresets, setInputPresets] = useState([])    // [{port,val}] preset for IN
  const [memStart, setMemStart] = useState(0x100)
  const [appState, setAppState] = useState('idle')  // idle | running | halted | error
  const [msg, setMsg]           = useState('Load an example or write code, then click Build.')
  const [steps, setSteps]       = useState(0)
  const [cycles, setCycles]     = useState(0)
  const [buildId, setBuildId]   = useState(0)
  const [symbols, setSymbols]   = useState({})
  const [programRegion, setProgramRegion] = useState(null)
  const [presetAddrs, setPresetAddrs]     = useState(new Set())
  const [cursorInst, setCursorInst] = useState(null)
  const [helpInst, setHelpInst]     = useState(null)
  const [errorLine, setErrorLine]   = useState(null)
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('sim8085_welcomed'))
  const [showCalc,    setShowCalc]    = useState(false)
  function dismissWelcome() { localStorage.setItem('sim8085_welcomed', '1'); setShowWelcome(false) }
  const [runSpeed, setRunSpeed]     = useState(3)        // index into SPEEDS
  const [regBase, setRegBase]       = useState('hex')    // 'hex'|'dec'|'bin'
  const [statusLog, setStatusLog]   = useState([])
  const [histLen, setHistLen]       = useState(0)        // for disabling Step Back button
  const timerRef    = useRef(null)
  const editorColRef = useRef(null)
  const rightColRef  = useRef(null)
  const gotoLineRef  = useRef(null)
  const fileInputRef   = useRef(null)
  const oneShotBpsRef  = useRef(new Set())
  const disasmJumpRef  = useRef(null)
  const memWatchMemRef = useRef(null)
  const [addrLineMap, setAddrLineMap] = useState(new Map())
  const srcRef      = useRef(src)
  const speedRef    = useRef(3)
  const historyRef  = useRef([])
  const bpsRef      = useRef(new Map())
  const prevMemRef  = useRef(null)

  useEffect(() => { bpsRef.current = bps }, [bps])

  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem('sim8085_program', src) } catch {} }, 1000)
    return () => clearTimeout(t)
  }, [src])

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

  function onRightResizeDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = rightColRef.current.getBoundingClientRect().width
    function onMove(ev) {
      rightColRef.current.style.flexBasis = Math.max(160, Math.min(600, startW - (ev.clientX - startX))) + 'px'
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function onMemWatchDividerDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = memWatchMemRef.current.getBoundingClientRect().width
    function onMove(ev) {
      memWatchMemRef.current.style.flex = `0 0 ${Math.max(80, startW + (ev.clientX - startX))}px`
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
  useEffect(() => { hotkeysRef.current = { doAssemble, handleReset, doStep, handleRun, running, appState } })
  useEffect(() => {
    function onKey(e) {
      const h = hotkeysRef.current
      if (e.key === 'F5') { e.preventDefault(); h.doAssemble(srcRef.current) }
      if (e.key === 'F6') { e.preventDefault(); h.handleReset() }
      if (e.key === 'F7') { e.preventDefault(); if (!h.running && h.appState !== 'error') h.doStep() }
      if (e.key === 'F9') { e.preventDefault(); if (h.appState !== 'error' || h.running) h.handleRun() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (msg === 'Load an example or write code, then click Build.') return
    const t = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})
    const kind = msg.startsWith('✗') ? 'error' : msg.startsWith('✓') ? 'success' : msg.startsWith('■') ? 'halted' : 'info'
    setStatusLog(log => [...log.slice(-19), { text: msg, kind, t }])
  }, [msg])

  function refresh() {
    const r = sim.simGetRegisters()
    setRegs(old => { setPrev(old); return r })
    setLeds(sim.simGetAllLeds())
    setCycles(sim.simGetCycles())
  }

  function refreshOutputPorts() {
    setOutputPorts(sim.simGetOutputPorts())
  }

  function doAssemble(code) {
    try {
      stopRun()
      historyRef.current = []
      setHistLen(0)
      setTrace([])
      setChangedAddrs(new Set())
      setOutputPorts([])
      prevMemRef.current = null
      sim.simInit()
      const res = sim.simAssemble(code)
      setBuildId(id => id + 1)
      setSteps(0)
      refresh()
      if (!res.ok) {
        const m = res.errorMsg?.match(/^Line (\d+)/)
        setErrorLine(m ? parseInt(m[1]) : null)
        setAddrLineMap(new Map())
        setSymbols({})
        setProgramRegion(null)
        setPresetAddrs(new Set())
        setAppState('error')
        setMsg(`✗ ${res.errorMsg}`)
      } else {
        setErrorLine(null)
        setAppState('idle')
        setAddrLineMap(buildAddrLineMap(code))
        setSymbols(sim.simGetSymbols())
        setProgramRegion(sim.simGetProgramRegion())
        setPresetAddrs(sim.simGetPresetAddrs())
        const t = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})
        setMsg(`✓ ${res.bytesEmitted}B at ${hex4(res.entryPoint)}H — ready  ${t}`)
      }
    } catch (err) {
      setAppState('error')
      setMsg(`✗ Internal error: ${err.message}`)
    }
  }

  function pushHistory() {
    const snap = { regs: sim.simGetRegisters(), ram: sim.simGetFullMemory() }
    const next = [...historyRef.current.slice(-9), snap]
    historyRef.current = next
    setHistLen(next.length)
  }

  function doStep() {
    stopRun()
    pushHistory()
    const prevR = sim.simGetRegisters()
    const ok = sim.simStep()
    setSteps(s => s+1)
    refresh()
    addTraceEntry(prevR)
    updateMemDiff()
    refreshOutputPorts()
    if (!ok) {
      setAppState(sim.simIsHalted() ? 'halted' : 'error')
      setMsg(sim.simIsHalted() ? '■ Program halted.' : `✗ ${sim.simGetError()}`)
    }
  }

  function doStepBack() {
    if (!historyRef.current.length) return
    const snap = historyRef.current[historyRef.current.length - 1]
    const next = historyRef.current.slice(0, -1)
    historyRef.current = next
    setHistLen(next.length)
    sim.simRestoreSnapshot(snap)
    setSteps(s => Math.max(0, s - 1))
    setAppState('idle')
    refresh()
  }

  function startRun() {
    if (timerRef.current) return
    setAppState('running')
    setMsg('▶ Running…')
    timerRef.current = setInterval(() => {
      const n = sim.simRun(SPEEDS[speedRef.current].steps)
      setSteps(s => s + n)
      refresh()
      updateMemDiff()
      refreshOutputPorts()
      if (!sim.simIsRunning()) {
        const r = sim.simGetRegisters()
        const cond = bpsRef.current.get(r.pc)
        // Conditional BP whose condition is not met — skip and continue
        if (cond != null && !evalCondition(cond, r)) {
          sim.simStep()
          return
        }
        // Clean up one-shot breakpoints
        if (oneShotBpsRef.current.size > 0) {
          const next = new Map(bpsRef.current)
          for (const addr of oneShotBpsRef.current) next.delete(addr)
          oneShotBpsRef.current.clear()
          syncBps(next)
        }
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

  function addTraceEntry(prevR) {
    const r = sim.simGetRegisters()
    const d = sim.simDisassemble(prevR.pc)
    const SKIP = new Set(['pc', 'flags', 'halted', 'hasError'])
    const changed = Object.keys(prevR).filter(k => !SKIP.has(k) && typeof prevR[k]==='number' && r[k] !== prevR[k])
    setTrace(t => {
      const entry = { addr: prevR.pc, text: d.text, regs: r, changedKeys: changed }
      return t.length >= 50 ? [...t.slice(1), entry] : [...t, entry]
    })
  }

  function updateMemDiff() {
    const curr = sim.simGetFullMemory()
    if (!prevMemRef.current) { prevMemRef.current = curr; return }
    const changed = new Set()
    for (let i = 0; i < curr.length; i++)
      if (curr[i] !== prevMemRef.current[i]) changed.add(i)
    prevMemRef.current = curr
    setChangedAddrs(changed)
  }

  function syncBps(nextMap) {
    sim.simClearAllBreakpoints()
    for (const addr of nextMap.keys()) sim.simSetBreakpoint(addr)
    setBps(nextMap)
    bpsRef.current = nextMap
  }

  function toggleBp(addr) {
    const next = new Map(bps)
    next.has(addr) ? next.delete(addr) : next.set(addr, null)
    syncBps(next)
  }

  function openConditionDialog(addr) {
    if (!bps.has(addr)) return
    const cur = bps.get(addr) || ''
    const expr = window.prompt(
      `Condition at ${hex4(addr)}H — use A B C D E H L PC SP BC DE HL FLAGS\n(e.g.  A==0   B>10   HL>=0x200)\nLeave empty for unconditional:`,
      cur
    )
    if (expr === null) return
    const next = new Map(bps)
    next.set(addr, expr.trim() || null)
    syncBps(next)
  }

  function exportFile() {
    const blob = new Blob([srcRef.current], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'program.asm'
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  function importFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const code = ev.target.result
      srcRef.current = code; setSrc(code); doAssemble(code)
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  function shareURL() {
    const encoded = b64encode(srcRef.current)
    const base = location.href.split('#')[0]
    const url = `${base}#code=${encoded}`
    navigator.clipboard.writeText(url)
      .then(() => setMsg('✓ URL copied to clipboard!'))
      .catch(() => window.prompt('Copy this URL:', url))
  }

  function runToAddr(addr) {
    if (appState === 'error') return
    if (!bpsRef.current.has(addr)) {
      oneShotBpsRef.current.add(addr)
      const next = new Map(bpsRef.current)
      next.set(addr, null)
      syncBps(next)
    }
    startRun()
  }

  function loadExample(key) {
    const sep  = key.indexOf('::')
    const code = EXAMPLES[key.slice(0, sep)]?.[key.slice(sep + 2)]
    if (!code) return
    srcRef.current = code
    setSrc(code)
    doAssemble(code)
  }

  function setInputPort(port, val) {
    sim.simSetInputPort(port, val)
    setInputPresets(ps => {
      const next = ps.filter(p => p.port !== port)
      return [...next, { port, val }].sort((a,b) => a.port - b.port)
    })
  }

  function removeInputPort(port) {
    sim.simClearInputPort(port)
    setInputPresets(ps => ps.filter(p => p.port !== port))
  }

  const running = appState === 'running'

  return (
    <div className="app">
      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="brand">
          <BrandMenu
            onShowWelcome={() => { localStorage.removeItem('sim8085_welcomed'); setShowWelcome(true) }}
            onImport={() => fileInputRef.current.click()}
            onExport={exportFile}
            onShare={shareURL}
            onCalc={() => setShowCalc(c => !c)} />
        </div>

        <div className="toolbar">
          <ExampleMenu onLoad={loadExample} />
          <input type="file" ref={fileInputRef} style={{display:'none'}} accept=".asm,.85,.s,.txt" onChange={importFile} />
          <button className="btn btn-asm"   onClick={() => doAssemble(srcRef.current)}>⚙ Build  <kbd>F5</kbd></button>
          <button className="btn btn-step"  onClick={doStep}  disabled={running || appState==='error'}>↓ Step  <kbd>F7</kbd></button>
          <button className="btn btn-back"  onClick={doStepBack} disabled={running || appState==='error' || histLen === 0} title="Undo last step">⟲ Back</button>
          <button className={`btn ${running ? 'btn-stop':'btn-run'}`} onClick={handleRun}
            disabled={!running && appState==='error'}>
            {running ? '■ Stop' : '▶ Run'}  <kbd>{running?'F9':'F9'}</kbd>
          </button>
          <label className="speed-label" title={`${SPEEDS[runSpeed].steps} steps/tick`}>
            Speed
            <input type="range" min={0} max={4} value={runSpeed} className="speed-slider"
              onChange={e => { const v = +e.target.value; setRunSpeed(v); speedRef.current = v }} />
            <span className="speed-val">{SPEEDS[runSpeed].label}</span>
          </label>
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
          {cycles > 0 && <span className="status-cycles">{cycles.toLocaleString()} T</span>}
        </div>
      </div>

      {/* ── Workspace ── */}
      <div className="workspace">
        {/* Editor column */}
        <div className="col col-editor" ref={editorColRef}>
          <div className="panel editor-panel">
            <div className="panel-hd">
            <span className="panel-icon">✏️</span>EDITOR
            <div className="panel-hd-right">
              <span className="editor-hint">; semicolons for comments</span>
              <PanelHelp panel="EDITOR" />
            </div>
          </div>
            <AsmEditor value={src} onChange={v => { srcRef.current = v; setSrc(v) }} gotoRef={gotoLineRef}
              onCursorInstruction={setCursorInst}
              onInstructionDetail={setHelpInst}
              errorLine={errorLine} />
          </div>
          <HelpPanel instruction={cursorInst} />
          <LedDisplay leds={leds} />
        </div>
        <div className="col-resize-handle" onMouseDown={onEditorResizeDown} />

        {/* Code + Memory column */}
        <div className="col col-center">
          <DisasmPanel regs={regs} breakpoints={bps} onToggleBp={toggleBp} buildId={buildId}
            onSetCondition={openConditionDialog}
            onRunTo={runToAddr}
            jumpRef={disasmJumpRef}
            symbols={symbols}
            onJumpMem={setMemStart}
            onGotoLine={(addr, labelName) => { const ln = addrLineMap.get(addr); if (ln) gotoLineRef.current?.(ln, labelName) }} />
          <ChatPanel regs={regs} src={src} />
          <div className="mem-watch-row">
            <div className="mem-watch-mem" ref={memWatchMemRef}>
              <MemPanel
                memStart={memStart}
                onJump={setMemStart}
                regs={regs}
                buildId={buildId}
                changedAddrs={changedAddrs}
                programRegion={programRegion}
                presetAddrs={presetAddrs}
              />
            </div>
            <div className="mem-watch-divider" onMouseDown={onMemWatchDividerDown} />
            <div className="mem-watch-watch">
              <WatchPanel watches={watches} regs={regs}
                onAdd={w => setWatches(ws => [...ws, w])}
                onRemove={i => setWatches(ws => ws.filter((_,j) => j !== i))}
                regBase={regBase} onRegBase={setRegBase} />
            </div>
          </div>
          <div className="jump-row">
            <button className="btn btn-xs" onClick={()=>setMemStart(regs.pc & 0xFFF0)}>→ PC</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(regs.sp & 0xFFF0)}>→ SP</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(0x100)}>→ 100H</button>
            <button className="btn btn-xs" onClick={()=>setMemStart(0x200)}>→ 200H</button>
          </div>
        </div>
        <div className="col-resize-handle" onMouseDown={onRightResizeDown} />

        {/* Registers column */}
        <div className="col col-right" ref={rightColRef}>
          <RegPanel   regs={regs} prev={prevRegs} onJump={setMemStart}
            regBase={regBase} onRegBase={setRegBase} onEdit={refresh} />
          <PairPanel  regs={regs} prev={prevRegs} onJump={setMemStart} onEdit={refresh}
            regBase={regBase} onRegBase={setRegBase} />
          <FlagPanel  regs={regs} />
          <IOPortPanel outputPorts={outputPorts} inputPresets={inputPresets}
            onSetInput={setInputPort} onRemoveInput={removeInputPort} />
          <StackPanel regs={regs} regBase={regBase} onRegBase={setRegBase} />
          <TracePanel trace={trace} onClear={() => setTrace([])} />
        </div>
      </div>
      <div className="statusbar">
        {statusLog.length === 0
          ? <span className="statusbar-empty">Ready</span>
          : statusLog.slice().reverse().slice(0, 4).map((e, i) => (
            <div key={i} className={`statusbar-entry sbar-${e.kind}`}>
              <span className="statusbar-time">{e.t}</span>
              <span className="statusbar-text">{e.text}</span>
            </div>
          ))
        }
      </div>
      {showWelcome && <WelcomeModal onClose={dismissWelcome} />}
      {helpInst && <HelpModal instruction={helpInst} onClose={() => setHelpInst(null)} />}
      {showCalc && <CalcFloat onClose={() => setShowCalc(false)} />}
    </div>
  )
}
