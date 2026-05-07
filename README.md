# sim8085 — 8085 Microprocessor Simulator

A complete Intel 8085 simulator ported from the original DOS application
by Vijay Kumar (1995) to a modern web platform.

**[Live Demo →](https://selfmodify.github.io/sim8085wasm/)**

---

![sim8085 — LED counter running at turbo speed](screenshots/gif-01-turbo-led.gif)

<table>
<tr>
<td><img src="screenshots/02-editor-panel.png" alt="Editor — write 8085 assembly with syntax highlighting and 20+ built-in examples"></td>
<td><img src="screenshots/03-center-panel.png" alt="Center — live disassembly and hex memory editor"></td>
<td><img src="screenshots/04-right-panel.png" alt="Right — registers, flags, interrupts, and I/O ports"></td>
</tr>
<tr>
<td align="center"><sub>Editor · 20+ built-in examples</sub></td>
<td align="center"><sub>Live disassembly · hex memory editor</sub></td>
<td align="center"><sub>Registers · flags · interrupts · I/O ports</sub></td>
</tr>
</table>

---

## Debugger

<table>
<tr>
<td><img src="screenshots/gif-02-step-debug.gif" alt="Single-step debugging — registers highlight green on each step"></td>
<td><img src="screenshots/gif-04-breakpoint.gif" alt="Breakpoints — click any instruction in the disassembly to set one"></td>
</tr>
<tr>
<td align="center"><sub>Single-step · registers highlight on change</sub></td>
<td align="center"><sub>Breakpoints · click any disassembly row</sub></td>
</tr>
<tr>
<td><img src="screenshots/gif-03-step-over.gif" alt="Step-over — skips subroutines and system calls atomically"></td>
<td><img src="screenshots/gif-05-step-back.gif" alt="Step-back — time-travel through execution history"></td>
</tr>
<tr>
<td align="center"><sub>Step-over · skips subroutines atomically</sub></td>
<td align="center"><sub>Step-back · time-travel through history</sub></td>
</tr>
</table>

---

## Interrupts & I/O

<table>
<tr>
<td><img src="screenshots/05-breakpoint.png" alt="Breakpoint paused in disassembly view"></td>
<td><img src="screenshots/06-interrupt.png" alt="TRAP interrupt fired mid-program"></td>
<td><img src="screenshots/07-keyboard.png" alt="Keyboard queue — keystrokes dequeued via CALL 5"></td>
</tr>
<tr>
<td align="center"><sub>Breakpoint paused · inspect state</sub></td>
<td align="center"><sub>TRAP · RST 7.5 / 6.5 / 5.5 interrupts</sub></td>
<td align="center"><sub>Keyboard queue · CALL 5 read-key syscall</sub></td>
</tr>
</table>

---

## Themes

<table>
<tr>
<td><img src="screenshots/theme-green.png"      alt="Green CRT theme"></td>
<td><img src="screenshots/theme-dim.png"        alt="Dim theme"></td>
<td><img src="screenshots/theme-light.png"      alt="Light theme"></td>
<td><img src="screenshots/theme-amber-mono.png" alt="Amber monochrome CRT theme"></td>
</tr>
<tr>
<td align="center"><sub>🟢 Green CRT</sub></td>
<td align="center"><sub>🌗 Dim</sub></td>
<td align="center"><sub>☀︎ Light</sub></td>
<td align="center"><sub>🟡 Amber mono</sub></td>
</tr>
<tr>
<td><img src="screenshots/theme-gray-crt.png"   alt="Gray CRT theme"></td>
<td><img src="screenshots/theme-turbo-c.png"    alt="Turbo C theme"></td>
<td><img src="screenshots/theme-cp437.png"      alt="DOS CP437 theme"></td>
<td></td>
</tr>
<tr>
<td align="center"><sub>⬜ Gray CRT</sub></td>
<td align="center"><sub>🔵 Turbo C</sub></td>
<td align="center"><sub>🔳 DOS CP437</sub></td>
<td></td>
</tr>
</table>

---

## Features

- **Full 8085 instruction set** — all 256 opcodes, correct flag behavior, HLT halt-wait with interrupt resume
- **Two-pass assembler** — labels, directives (`ORG`, `KICKOFF`, `SETBYTE`, `SETWORD`), hex literals
- **Interactive debugger** — step, run, breakpoints (click any instruction in disassembly)
- **Live register panel** — changed registers highlighted in green after every step
- **Flag display** — S, Z, AC, P, CY decoded and shown
- **Watch variables** — monitor any register or memory address in real time
- **Hex memory editor** — double-click any cell to edit; PC and SP highlighted
- **Memory tools** — search for bytes, fill ranges, and export to `.bin`
- **Disassembly view** — live disassembly following PC
- **Stack inspector** — top-of-stack shown with decoded values
- **Call stack** — tracks active `CALL` and `RST` subroutines
- **Execution trace** — logs the last 50 executed instructions and register deltas
- **Memory map** — visual representation of Code, Data, and Stack regions in RAM
- **Interrupt support** — TRAP, RST 7.5, RST 6.5, RST 5.5 with enable/disable controls
- **Hardware Peripherals** — 8255 PPI, 8253 PIT, Audio Output, and 7-segment LED display
- **ASCII Console** — view characters written via `OUT` to the console port
- **Keyboard input** — queue keystrokes for `CALL 5 / C=01H` read-key syscall
- **Configurable RAM** — 16 KB, 32 KB, or 64 KB selectable from the menu
- **20+ built-in examples** — Arithmetic, Algorithms, I/O, Strings, Interrupts categories
- **Community Gallery & Challenges** — Load/share GitHub Gists and solve auto-verified coding challenges
- **Cloud Storage** — Native Google Drive and GitHub integration to seamlessly save and load scripts
- **AI Assistant & Tools** — Built-in multi-base calculator and Anthropic Claude AI integration
- **Zero runtime dependencies** — pure JS, no server, works fully offline

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F5` / `F6` | Assemble (Build) / Reset |
| `F7` / `F8` | Step one instruction / Step over subroutine |
| `F9` / `F10` | Run/Stop / Step out of subroutine |
| `Ctrl + F` | Find / Replace in editor |
| `Ctrl + Click` | Open inline instruction reference for mnemonic |
| `Right-Click` | Context menu (Run to here, Conditional Breakpoints) |
| `?` | Show keyboard shortcuts modal |

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

Based on **sim8085** by Vijay Kumar, originally distributed via Simtel.Net (1995).
The original was a 16-bit DOS application using Borland C++ with direct video
RAM writes, BIOS interrupts, and CP437 box-drawing characters.

This port preserves the complete instruction set, assembler, and LED
display system while replacing the DOS UI layer with a modern web interface.

---

## License

The original sim8085 source was distributed as freeware via Simtel.Net.
This port is released under the MIT License.
