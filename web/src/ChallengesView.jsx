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
]

export function ChallengesView({ onSelect, onSolution }) {
  return (
    <div className="challenges-view">
      <div className="challenges-container">
        <div className="challenges-header">
          <h1>EDUCATIONAL CHALLENGES</h1>
          <p>Select a challenge to load its initial state into the simulator. Run your code to automatically verify the result.</p>
        </div>
        <div className="challenge-grid">
          {CHALLENGES.map(c => (
            <div key={c.id} className="challenge-card" onClick={() => onSelect(c)}>
              <div className="challenge-title">{c.title}</div>
              <div className="challenge-desc">{c.desc}</div>
              <button
                className="btn"
                onClick={e => { e.stopPropagation(); onSolution(c); }}
              >Show solution</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}