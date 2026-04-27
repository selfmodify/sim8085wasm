# sim8085 — 8085 Microprocessor Simulator

A complete Intel 8085 simulator ported from the original DOS application
by Vijay Kumar (1995) to a modern web platform.

**[Live Demo →](https://selfmodify.github.io/sim8085wasm/)**

---

![sim8085 — LED counter running at turbo speed](screenshots/01-led-count.png)

<table>
<tr>
<td><img src="screenshots/02-editor-panel.png" alt="Editor panel — write 8085 assembly with syntax highlighting and 20+ built-in examples"></td>
<td><img src="screenshots/03-center-panel.png" alt="Center panel — live disassembly and hex memory editor"></td>
<td><img src="screenshots/04-right-panel.png" alt="Right panel — registers, flags, interrupts, and I/O ports"></td>
</tr>
</table>

---

## Features

- **Full 8085 instruction set** — all 256 opcodes, correct flag behavior, HLT halt-wait with interrupt resume
- **Two-pass assembler** — labels, directives (`ORG`, `KICKOFF`, `SETBYTE`, `SETWORD`), hex literals
- **Interactive debugger** — step, run, breakpoints (click any instruction in disassembly)
- **Live register panel** — changed registers highlighted in green after every step
- **Flag display** — S, Z, AC, P, CY decoded and shown
- **Hex memory editor** — double-click any cell to edit; PC and SP highlighted
- **Disassembly view** — live disassembly following PC
- **Stack inspector** — top-of-stack shown with decoded values
- **7-segment LED display** — Intel SDK system calls (`CALL 5`) drive the LEDs
- **Interrupt support** — TRAP, RST 7.5, RST 6.5, RST 5.5 with enable/disable controls
- **Keyboard input** — queue keystrokes for `CALL 5 / C=01H` read-key syscall
- **Configurable RAM** — 16 KB, 32 KB, or 64 KB selectable from the menu
- **20+ built-in examples** — Arithmetic, Algorithms, I/O, Strings, Interrupts categories
- **Zero runtime dependencies** — pure JS, no server, works fully offline

---

## Project Structure

```
sim8085-web/
├── core/                    # Portable C core (compiles to WASM or native)
│   ├── sim8085_core.h       # All types, constants, machine struct, macros
│   ├── sim8085_core.c       # CPU engine, assembler, system calls
│   ├── sim8085_api.h        # Clean public API (Emscripten-exported functions)
│   ├── sim8085_api.c        # API implementation
│   └── test_main.c          # Native test suite (22/22 passing)
├── web/                     # React frontend
│   ├── src/
│   │   ├── sim8085Bridge.js # Pure-JS CPU + assembler (no WASM needed)
│   │   ├── App.jsx          # Complete UI — editor, registers, memory, LEDs
│   │   └── App.css          # Retro-terminal dark theme
│   ├── vite.config.js
│   └── package.json
├── CMakeLists.txt           # Native test build + Emscripten WASM build
└── .github/workflows/
    └── deploy.yml           # Auto-deploy to GitHub Pages on push
```

---

## Quick Start

### Run the web app locally

```bash
cd web
npm install
npm run dev
# open http://localhost:5173/sim8085/
```

### Build for production

```bash
cd web
npm run build
# output in web/dist/ — serve from any static host
```

### Run the C core tests

```bash
mkdir build && cd build
cmake ..
make
./sim8085_test
# Expected: 22/22 passed
```

### Build WebAssembly (optional, for future WASM integration)

```bash
# Requires Emscripten SDK: https://emscripten.org/docs/getting_started/
source /path/to/emsdk/emsdk_env.sh
mkdir build-wasm && cd build-wasm
emcmake cmake ..
make
# Output: web/public/sim8085.js (WASM embedded as base64)
```

---

## Deploying to GitHub Pages

1. Push this repo to GitHub as `yourusername/sim8085`
2. Go to **Settings → Pages → Source** → select **GitHub Actions**
3. Push to `main` — the workflow builds and deploys automatically
4. Your simulator is live at `https://yourusername.github.io/sim8085/`

To use a custom domain or deploy to Netlify/Vercel, change `base: '/sim8085/'`
to `base: '/'` in `web/vite.config.js`.

---

## 8085 Assembly Syntax

```asm
; This is a comment
    org     100H        ; set assembly address
    kickoff 100H        ; set execution start address
    setbyte 300H, 42H  ; pre-load memory

start:
    mvi  a, 0FFH       ; load immediate (hex with H suffix)
    mvi  b, 10         ; decimal literal
    add  b             ; A = A + B
    sta  400H          ; store A to memory
    lxi  h, 200H       ; load HL pair
    mov  m, a          ; store A to [HL]
    jnz  start         ; jump if not zero
    hlt                ; halt

    ; Subroutine
mysub:
    ret
```

**Supported directives:**
| Directive | Example | Effect |
|-----------|---------|--------|
| `ORG`     | `org 100H` | Set assembly pointer |
| `KICKOFF` | `kickoff 100H` | Set execution entry point |
| `SETBYTE` | `setbyte 300H, 42H` | Pre-load one byte |
| `SETWORD` | `setword 300H, 1234H` | Pre-load two bytes |

**Number formats:** `42H` or `42h` (hex), `42` (hex by default),
`42D` (decimal), `00101010B` (binary)

---

## Intel SDK System Calls (CALL 5)

Programs can use the Intel SDK monitor calls:

| C reg | Function |
|-------|----------|
| 00H | System reset |
| 01H | Read hex key → A |
| 02H | Write digit to LED (B = field, HL → data) |
| 03H | Blank LED fields (B = 0/1/2/3) |
| 09H | Scroll LED display left, new digit from D |
| 0BH | Scroll LED display (same as 09H) |

Example (from `LED Scroll`):
```asm
    mvi  c, 0bH        ; scroll function
    mov  d, a          ; digit to insert
    call 5             ; invoke SDK
```

---

## Architecture

```
┌─────────────────────────────────────┐
│  React UI  (App.jsx)                │
│  Editor │ Disasm │ Regs │ Mem │ LED │
└────────────────┬────────────────────┘
                 │ calls
┌────────────────▼────────────────────┐
│  sim8085Bridge.js                   │
│  Pure-JS assembler + CPU engine     │
│  (mirrors the C API exactly)        │
└────────────────┬────────────────────┘
                 │ future: replace with
┌────────────────▼────────────────────┐
│  sim8085.wasm  (from C core)        │
│  sim8085_core.c + sim8085_api.c     │
│  Compiled by Emscripten             │
└─────────────────────────────────────┘
```

The JS bridge and WASM module expose the **same API** — swapping
them requires changing only the import in `App.jsx`.

---

## Original Project

Based on **sim8085** by V. Kumar, originally distributed via Simtel.Net (1995).
The original was a 16-bit DOS application using Borland C++ with direct video
RAM writes, BIOS interrupts, and CP437 box-drawing characters.

This port preserves the complete instruction set, assembler, and LED
display system while replacing the DOS UI layer with a modern web interface.

---

## License

The original sim8085 source was distributed as freeware via Simtel.Net.
This port is released under the MIT License.
