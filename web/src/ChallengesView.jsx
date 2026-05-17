import * as sim from './simProxy.js';

export const CHALLENGES = [
  {
    id: 'c1', title: '1. The Basics: Addition',
    desc: 'Write a program to add the byte at 0200H to the byte at 0201H and store the 8-bit result in 0202H.',
    setup: '    setbyte 200H, 15H\n    setbyte 201H, 20H',
    test: () => sim.simReadByte(0x0202) === 0x35,
    successMsg: '0202H correctly contains 35H.',
    solution: '    LDA 0200H    ; load first operand\n    MOV B, A      ; save in B\n    LDA 0201H    ; load second operand\n    ADD B         ; A = A + B\n    STA 0202H    ; store result',
  },
  {
    id: 'c2', title: '2. Array Maximum',
    desc: 'Find the maximum value in an array of 8 bytes starting at 0200H. Store the result at 0210H.',
    setup: '    setbyte 200H, 34H\n    setbyte 201H, 78H\n    setbyte 202H, 12H\n    setbyte 203H, 9AH\n    setbyte 204H, 56H\n    setbyte 205H, 0BH\n    setbyte 206H, 0EFH\n    setbyte 207H, 23H',
    test: () => sim.simReadByte(0x0210) === 0xEF,
    successMsg: '0210H correctly contains EFH.',
    solution: '    LXI H, 0200H  ; point HL at start of array\n    MOV A, M      ; A = first element (current max)\n    MVI B, 07H    ; B = 7 remaining comparisons\nMAXLOOP:\n    INX H\n    CMP M         ; compare A with next element\n    JNC SKIP      ; if A >= M, keep current max\n    MOV A, M      ; else new max found\nSKIP:\n    DCR B\n    JNZ MAXLOOP\n    STA 0210H     ; store result',
  },
  {
    id: 'c3', title: '3. Multiplication',
    desc: 'Multiply the byte at 0200H by the byte at 0201H. Store the 16-bit result at 0202H.',
    setup: '    setbyte 200H, 0CH\n    setbyte 201H, 0AH',
    test: () => sim.simReadByte(0x0202) === 0x78 && sim.simReadByte(0x0203) === 0x00,
    successMsg: '0202H correctly contains 0078H.',
    solution: '    LDA 0200H     ; A = multiplicand (count)\n    MOV C, A\n    LDA 0201H     ; A = multiplier (value to add)\n    MOV B, A\n    MVI A, 00H    ; A = running sum (low byte)\n    MVI H, 00H    ; H = high byte of sum\nMULLOOP:\n    ADD B         ; sum = sum + multiplier\n    JNC MULSKIP\n    INR H         ; propagate carry to high byte\nMULSKIP:\n    DCR C\n    JNZ MULLOOP\n    MOV L, A\n    SHLD 0202H    ; store 16-bit result (L→0202H, H→0203H)',
  },
  {
    id: 'c4', title: '4. String Length',
    desc: 'Count the length of a null-terminated ASCII string starting at 0200H. Store the byte count at 0210H.',
    setup: '    org 200H\n    db "Hello", 00H',
    test: () => sim.simReadByte(0x0210) === 0x05,
    successMsg: '0210H correctly contains 05H.',
    solution: '    LXI H, 0200H  ; point HL at string start\n    MVI C, 00H    ; C = length counter\nLENLOOP:\n    MOV A, M      ; load next character\n    ORA A         ; set flags (Z=1 if null terminator)\n    JZ LENDONE\n    INR C         ; count the character\n    INX H\n    JMP LENLOOP\nLENDONE:\n    MOV A, C\n    STA 0210H     ; store length',
  },
  {
    id: 'c5', title: '5. Bubble Sort',
    desc: 'Sort an array of 8 unsigned bytes at 0200H in ascending order (in-place).',
    setup: '    setbyte 200H, 64H\n    setbyte 201H, 02H\n    setbyte 202H, 45H\n    setbyte 203H, 1AH\n    setbyte 204H, 88H\n    setbyte 205H, 37H\n    setbyte 206H, 0CH\n    setbyte 207H, 73H',
    test: () => {
      const expected = [0x02, 0x0C, 0x1A, 0x37, 0x45, 0x64, 0x73, 0x88]
      return expected.every((v, i) => sim.simReadByte(0x0200 + i) === v)
    },
    successMsg: '0200H–0207H correctly sorted in ascending order.',
    solution: '    MVI D, 07H    ; D = outer loop count (N-1 passes)\nOUTER:\n    LXI H, 0200H  ; reset pointer to start of array\n    MOV C, D      ; C = inner loop count\nINNER:\n    MOV A, M      ; A = current element\n    INX H\n    CMP M         ; compare with next element\n    JC NOSWAP     ; if A < M, already in order\n    MOV B, M      ; swap: B = next\n    MOV M, A      ; put current into next slot\n    DCX H\n    MOV M, B      ; put next into current slot\n    INX H\nNOSWAP:\n    DCR C\n    JNZ INNER\n    DCR D\n    JNZ OUTER\n    HLT',
  },
  {
    id: 'c6', title: '6. Count Set Bits',
    desc: 'Count the number of 1-bits (popcount) in the byte at 0200H. Store the result at 0201H.',
    setup: '    setbyte 200H, 6BH',
    test: () => sim.simReadByte(0x0201) === 5,
    successMsg: '0201H correctly contains 05H (6BH = 0110 1011 has five 1-bits).',
    solution: '    LDA 0200H     ; A = input byte\n    MVI C, 00H    ; C = bit counter\n    MVI B, 08H    ; B = 8 iterations\nBITLOOP:\n    RAR           ; rotate A right through carry\n    JNC BITSKIP   ; if bit was 0, skip count\n    INR C         ; count the 1-bit\nBITSKIP:\n    DCR B\n    JNZ BITLOOP\n    MOV A, C\n    STA 0201H     ; store result',
  },
  {
    id: 'c7', title: '7. Binary to BCD',
    desc: 'Convert the binary byte at 0200H (0–99) to packed BCD and store at 0201H. E.g. 0x4D (77) → 0x77.',
    setup: '    setbyte 200H, 4DH',
    test: () => sim.simReadByte(0x0201) === 0x77,
    successMsg: '0201H correctly contains 77H (packed BCD for decimal 77).',
    solution: '    LDA 0200H     ; A = binary input (0-99)\n    MVI B, 00H    ; B = tens digit\nDIVLOOP:\n    CPI 0AH       ; is A < 10?\n    JC DIVDONE\n    SUI 0AH       ; subtract 10\n    INR B         ; increment tens\n    JMP DIVLOOP\nDIVDONE:\n    MOV C, A      ; C = units digit\n    MOV A, B      ; A = tens\n    RLC\n    RLC\n    RLC\n    RLC           ; shift tens to upper nibble\n    ORA C         ; combine with units\n    STA 0201H     ; store packed BCD',
  },
  {
    id: 'c8', title: '8. Reverse an Array',
    desc: 'Reverse an 8-byte array at 0200H in-place.',
    setup: '    setbyte 200H, 11H\n    setbyte 201H, 22H\n    setbyte 202H, 33H\n    setbyte 203H, 44H\n    setbyte 204H, 55H\n    setbyte 205H, 66H\n    setbyte 206H, 77H\n    setbyte 207H, 88H',
    test: () => {
      const expected = [0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]
      return expected.every((v, i) => sim.simReadByte(0x0200 + i) === v)
    },
    successMsg: '0200H–0207H correctly reversed.',
    solution: '    LXI H, 0200H  ; HL = left pointer\n    LXI D, 0207H  ; DE = right pointer\n    MVI C, 04H    ; 4 swaps for 8 elements\nREVLOOP:\n    MOV A, M      ; A = left element\n    LDAX D        ; B via XCHG trick: load right\n    MOV B, A      ; B = right element\n    MOV A, M\n    STAX D        ; store left into right slot\n    MOV M, B      ; store right into left slot\n    INX H         ; advance left pointer\n    DCX D         ; retreat right pointer\n    DCR C\n    JNZ REVLOOP\n    HLT',
  },
  {
    id: 'c9', title: '9. Division',
    desc: 'Divide the unsigned byte at 0200H by the byte at 0201H. Store the quotient at 0202H and remainder at 0203H.',
    setup: '    setbyte 200H, 1BH\n    setbyte 201H, 04H',
    test: () => sim.simReadByte(0x0202) === 0x06 && sim.simReadByte(0x0203) === 0x03,
    successMsg: '0202H contains 06H (Quotient) and 0203H contains 03H (Remainder).',
    solution: '    LDA 0200H     ; A = Dividend\n    MOV B, A\n    LDA 0201H     ; A = Divisor\n    MOV C, A\n    MVI D, 00H    ; D = Quotient counter\n    MOV A, B\nDIVLOOP:\n    CMP C         ; Can we subtract Divisor?\n    JC DIVDONE    ; If Dividend < Divisor, we are done\n    SUB C         ; Subtract Divisor\n    INR D         ; Increment Quotient\n    JMP DIVLOOP\nDIVDONE:\n    STA 0203H     ; Remainder is left in A\n    MOV A, D\n    STA 0202H     ; Store Quotient\n    HLT',
  },
  {
    id: 'c10', title: '10. Fibonacci Sequence',
    desc: 'Generate the first 8 numbers of the Fibonacci sequence (1, 1, 2, 3, 5, 8, 13, 21) and store them consecutively in memory starting at 0200H.',
    setup: '    ; no setup required',
    test: () => {
      const expected = [1, 1, 2, 3, 5, 8, 13, 21]
      return expected.every((v, i) => sim.simReadByte(0x0200 + i) === v)
    },
    successMsg: '0200H–0207H contains the correct Fibonacci sequence.',
    solution: '    LXI H, 0200H  ; HL = Memory pointer\n    MVI C, 08H    ; C = Loop counter (8 numbers)\n    MVI D, 00H    ; D = Previous number 1 (initially 0)\n    MVI E, 01H    ; E = Previous number 2 (initially 1)\nFIBLOOP:\n    MOV M, E      ; Store current Fibonacci number\n    MOV A, D      ; A = Prev1\n    ADD E         ; A = Prev1 + Prev2\n    MOV D, E      ; Prev1 = Prev2\n    MOV E, A      ; Prev2 = New number\n    INX H         ; Advance memory pointer\n    DCR C         ; Decrement counter\n    JNZ FIBLOOP\n    HLT',
  },
  {
    id: 'c11', title: '11. Palindrome Check',
    desc: 'Check if the 5-byte string at 0200H is a palindrome. If it is, store 01H at 0210H, otherwise store 00H.',
    setup: '    setbyte 200H, \'R\'\n    setbyte 201H, \'A\'\n    setbyte 202H, \'D\'\n    setbyte 203H, \'A\'\n    setbyte 204H, \'R\'',
    test: () => sim.simReadByte(0x0210) === 0x01,
    successMsg: '0210H correctly contains 01H (True).',
    solution: '    LXI H, 0200H  ; HL = Left pointer\n    LXI D, 0204H  ; DE = Right pointer\n    MVI B, 02H    ; B = 2 comparisons needed\nPALLOOP:\n    MOV A, M      ; A = Left char\n    MOV C, A      ; C = Save left char\n    LDAX D        ; A = Right char\n    CMP C         ; Compare Left and Right\n    JNZ NOTPAL    ; If not equal, not a palindrome\n    INX H         ; Move left pointer right\n    DCX D         ; Move right pointer left\n    DCR B\n    JNZ PALLOOP\n    MVI A, 01H    ; It is a palindrome\n    STA 0210H\n    HLT\nNOTPAL:\n    MVI A, 00H    ; It is NOT a palindrome\n    STA 0210H\n    HLT',
  },
  {
    id: 'c12', title: '12. Audio Siren',
    desc: 'Create an audible siren by alternating a high pitch and low pitch to the Audio Panel (Port 40H) in a continuous loop.',
    setup: '    ; Note: Turn ON the Audio Panel and set Speed to Fast!',
    test: () => true, // Open-ended interactive challenge
    successMsg: 'Awesome! Did you hear the beautiful siren sound?',
    solution: 'SIREN:\n    MVI A, 30H    ; High pitch\n    OUT 40H       ; Send to audio port\n    CALL DELAY    ; Wait a moment\n    MVI A, 10H    ; Low pitch\n    OUT 40H       ; Send to audio port\n    CALL DELAY    ; Wait a moment\n    JMP SIREN     ; Repeat forever\n\nDELAY:\n    LXI B, 0FFFH  ; Load delay counter\nWAIT:\n    DCX B         ; Decrement counter\n    MOV A, B\n    ORA C         ; Check if zero\n    JNZ WAIT\n    RET',
  },
]

export function ChallengesView({ onSelect, onSolution, completedIds }) {
  const doneCount = completedIds ? [...completedIds].filter(id => CHALLENGES.some(c => c.id === id)).length : 0
  return (
    <div className="challenges-view">
      <div className="challenges-container">
        <div className="challenges-header">
          <h1>EDUCATIONAL CHALLENGES</h1>
          <p>Select a challenge to load its initial state into the simulator. Run your code to automatically verify the result.</p>
          {doneCount > 0 && <p className="challenges-progress">{doneCount} / {CHALLENGES.length} completed</p>}
        </div>
        <div className="challenge-grid">
          {CHALLENGES.map(c => {
            const done = completedIds?.has(c.id)
            return (
            <div key={c.id} className={`challenge-card${done ? ' done' : ''}`} onClick={() => onSelect(c)}>
              <div className="challenge-title">
                {c.title}
                {done && <span className="challenge-badge" title="Completed">✓</span>}
              </div>
              <div className="challenge-desc">{c.desc}</div>
              <button
                className="btn"
                onClick={e => { e.stopPropagation(); onSolution(c); }}
              >Show solution</button>
            </div>
          )})}
        </div>
      </div>
    </div>
  )
}