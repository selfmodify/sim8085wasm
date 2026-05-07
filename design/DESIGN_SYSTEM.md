# sim8085 — Design System

> 8085 Microprocessor Simulator. A single-page React web app that ports the original 1995 DOS-era **sim8085** by Vijay Kumar to a modern web platform. The aesthetic is unapologetically **retro-terminal** — dark slate background, terminal green primary, amber/red signal colors, monospace-forward typography, dense panels with thin borders.

**Live demo:** https://selfmodify.github.io/sim8085wasm/

---

## Sources

This system was reverse-engineered from a single GitHub repository:

- **Repo:** [`selfmodify/sim8085wasm`](https://github.com/selfmodify/sim8085wasm) @ `main`
- **Imported files** (kept under `web/` and `screenshots/` for reference):
  - `web/src/App.css` — full component CSS (1297 lines)
  - `web/src/App.jsx` — full React app (2595 lines, single-file)
  - `web/src/lang.js` — CodeMirror assembly highlighter
  - `web/public/favicon.svg`, `favicon.ico`, `icons.svg` (social symbols)
  - `web/src/assets/hero.png`, `web/index.html`, `web/package.json`
  - `screenshots/01–07-*.png` — reference UI captures

There is **only one product** in this system: the sim8085 web simulator. There is no marketing site, docs site, or mobile app — the entire surface is the in-app experience.

---

## Index

```
sim8085-design/
├── README.md                 # this file
├── SKILL.md                  # for Claude Code / Skills downloads
├── colors_and_type.css       # all CSS vars + base type
├── assets/                   # logos, icons, screenshots, hero
│   ├── favicon.svg           # the 8-bit-style "85" mark
│   ├── favicon.ico
│   ├── social-icons.svg      # SVG sprite: bluesky, github, x, discord, social, docs
│   ├── hero.png              # welcome-modal hero
│   └── screenshot-*.png      # reference captures
├── preview/                  # design-system cards (registered for review)
├── ui_kits/
│   └── sim8085/
│       ├── README.md
│       ├── index.html        # interactive simulator recreation
│       ├── components.jsx    # Button, Panel, Reg, Flag, MemCell, etc.
│       └── seven-seg.jsx     # the iconic LED digit
└── web/, screenshots/        # source artifacts kept for reference
```

---

## Product Context

sim8085 is a **debugger and simulator** for Intel 8085 assembly. It is a teaching tool first and a low-level inspector second, used by students learning microprocessor architecture and educators demonstrating it. The whole UI is tuned to make CPU state legible at every step: registers highlight green when they change, the program counter has a dedicated arrow in the disassembly, memory bytes get tinted by role (PC / SP / code / preset / data).

Three columns dominate the workspace:

1. **Editor column** — CodeMirror assembly editor + inline instruction help + 7-segment LED display.
2. **Center column** — Live disassembly, AI Assistant (BYO Anthropic API key), hex memory editor, watch list.
3. **Right column** — Registers, register pairs, flags (S Z AC P CY), interrupt FIRE buttons, I/O ports, keyboard queue.

A 60px topbar holds the brand chip ("8085" — green block, mono, kerned), an Examples menu (categorized: Arithmetic / Algorithms / I/O / Strings / Interrupts), and the run controls: **Build · Step · Back · Run · Reset** with a Speed slider that goes up to "Turbo".

---

## CONTENT FUNDAMENTALS

**Voice.** Direct, technical, second-person ("you"), zero marketing fluff. Copy reads like manpages and inline help, not like a landing page. Sentence fragments are common; full stops are optional in tight UI strings.

**Casing.**
- **Panel headers** — `ALL CAPS`, mono, 11px, letter-spacing 2px. (`REGISTERS`, `LED DISPLAY`, `I/O PORTS`).
- **Sub-section headers** — `ALL CAPS`, mono, 9px, letter-spacing 1.5px. (`INPUT  RETURNED BY IN`, `KEYBOARD  C=01H SYSCALL INPUT`).
- **Buttons** — Title Case for verbs (`Build`, `Step`, `Run`, `Reset`); ALL CAPS only for hardware-style toggles (`FIRE`, `OFF`, `HEX`, `PC↓`).
- **Body / help / modal copy** — Sentence case.

**Pronouns.** Always "you", never "we". The app speaks to one person debugging one program. Example help copy: `"Click any row to set a breakpoint"`, `"Pre-set input port values returned by the IN instruction"`.

**Abbreviations are first-class.** The audience knows what `PC`, `SP`, `IFF`, `RST 7.5`, `AC`, `CY`, `IN`, `OUT`, `HLT` are — never expand them inline. Help popups *do* expand on demand.

**Tone vibe.**
- *Mechanical, not friendly.* No exclamation marks except inside error strings. No "Let's…", no "Awesome!". 
- *Educational, not condescending.* When help is offered it's a `?` button — opt-in, never pushed.
- *Hardware-aware.* Words like `FIRE`, `KICKOFF`, `TRAP`, `HALT-WAIT`, `RAM`, `SDK` show up plainly. The product does not abstract the chip away.

**Specific copy examples (lifted from `App.jsx`):**
- Topbar status (running): `▶ Running...` (green, blinking)
- Status (halted): `⏸ Halted` (amber)
- Status (error): `✕ <error msg>` (red)
- Memory legend: `■ PC   ■ SP   ■ Code   ■ Data    double-click to edit · click + ↑↓ PgUp/Dn to scroll`
- Editor empty hint: `; semicolons for comments`
- Help empty: `Ctrl+click an instruction for details`
- AI key field: `Your Anthropic API key — stored only in this browser, never sent to any server other than Anthropic.`

**Emoji usage.** Limited and *only* as icons inside panel headers — never in prose. The set is fixed: 💡 (LED), 🧠 (CPU), 💾 (Memory), 🔔 (Interrupts), 🔌 (I/O), and a few in the welcome modal feature list. Outside panel headers, no emoji.

**Unicode glyphs as icons.** The toolbar leans on geometric unicode in lieu of icon fonts: `▶` (run), `↓` (build), `↻` (reset), `⌂` (back), `«`/`»` (mem page), `▲`/`▼` (mem step), `■` (legend swatch), `⚙` (settings). This is a deliberate aesthetic — terminal/ASCII-flavored.

---

## VISUAL FOUNDATIONS

### Color
- **Surface stack** is monochrome and very dark. Only four neutrals do real work: `#0d0f14` page → `#141720` panel → `#1a1e2b` panel header → `#20253a` chip/input. Borders ride 1px in `#2a3050` (default) → `#3a4568` (hover).
- **Brand color is a single terminal green** — `#4af0a0`. It marks anything *live, current, or correct*: PC arrow, status while running, "changed register" left-bar, run button, primary CTA on dark bg.
- **Amber `#f0a840`** is the *attention* color: SP highlight, pending interrupts, help popup borders, halted state, hex-mode toggle.
- **Red `#ff4040`** is reserved for **stop, error, breakpoint, destructive**. Never decorative.
- **Blue `#4090ff`** is *secondary action*: the Build button, instruction mnemonics in syntax highlighting, code-byte tint in memory.
- **LED red `#FF2200`** is exclusively the 7-segment LED on-state with a 5px red glow filter. No other element uses this color.
- All colored backgrounds on dark surfaces are **low-opacity tints** of the same hue (6 / 12 / 15 / 18 / 20 / 28 % alpha) — not solid fills.

### Type
- **Sans** (IBM Plex Sans, 400/600) is for prose only — modal body, help popups, chat copy.
- **Mono** (JetBrains Mono, 400/600/700, fallback Fira Code → Cascadia Code → system) is the default everywhere CPU state lives. Roughly 80% of visible text is mono.
- Sizes are aggressive and small: 9px section headers, 11px panel headers / tags, 12–13px most rows, 14px register values, 16px brand chip. The welcome modal goes up to ~20px h2; nothing in the live UI does.
- **Letter-spacing** is the texture. Headers wear `2px`; sub-headers `1.5px`. Numbers and code never have tracked spacing.

### Backgrounds
- **No images, no gradients, no textures.** The product is solid flat surfaces stacked by elevation.
- **No full-bleed photography.** The hero image (`hero.png`) is a small inline 32×32-style asset used inside the welcome modal, not a hero billboard.
- LED panel uses a subtly darker background (`#080a10`) than the main surface to read as a separate device.
- Memory cell roles are conveyed by *tinted backgrounds*: code = soft blue, preset = soft green, PC = bright green, SP = amber.

### Animation
- **Restrained.** Three motion primitives:
  1. `transition: all .12s` on hover for buttons.
  2. `blink 1s infinite` (opacity 1↔.5) on the running status text.
  3. `pc-flash .35s ease-out` — current disassembly row briefly brightens green when PC moves.
- No bounces, no springs, no sliding panels, no fade-in mounts. Nothing scales or rotates.

### Hover states
- **Buttons**: `border-color: --border` → `--border2`, `background: --bg2` → `--bg3`. Color does not change.
- **Rows** (registers / memory cells / disasm): subtle background shift to `--bg2`/`--bg3`.
- **Resize handles**: switch to accent color on hover (`--accent` or `--accent2`).
- **Disabled**: `opacity: .4`, `cursor: default`, no other change.

### Press / active states
- No explicit transform-on-press. The hover hover-color simply persists; clicked buttons rely on the resulting state change (status flips, panel scrolls, etc.) for feedback.

### Borders
- Panels: `1px solid --border` separating header from body.
- Buttons: `1px solid --border`, semantic variants restate the border in `--blue` / `--accent2` / `--red` / `--amber`.
- "Changed" register rows use a **2px left border** in green, matching IDE conventions.
- Memory editing cell uses `1px solid --accent` outline, *not* a border — preserves the grid.

### Shadows
- **No inset shadows.** Strictly outer drop-shadows for floating elements.
- Three elevations:
  - `--shadow-pop` `0 4px 16px rgba(0,0,0,.5)` — context menus, instruction tooltips.
  - `--shadow-menu` `0 8px 24px rgba(0,0,0,.6)` — dropdowns (Examples, brand menu).
  - `--shadow-modal` `0 12px 40px rgba(0,0,0,.7)` — welcome modal.
- LED digits get a single CSS filter glow: `drop-shadow(0 0 5px rgba(255, 40, 0, .8))`.

### Capsules vs gradients
- The brand chip is a green **filled capsule** (4px radius, dark text on green) — the only inverted-color element in the app. Everywhere else, color is conveyed by stroke + tinted fill, never solid gradient capsules.
- No gradient anywhere. No glassmorphism, no blur, no transparency on chrome.

### Layout
- **Three columns, full viewport height.** No max-width, no centering. The app fills any window edge-to-edge and scrolls horizontally only if forced narrow.
- Columns are draggable to resize via 4px `ew-resize` handles in `--bg3`.
- Columns: 340px editor (min 180), flex center (min 280), 300px right (min 200).
- Topbar is a fixed 60px slab. Status bar at the bottom is a single mono row.
- Nothing floats over content except: dropdown menus, the calculator window (draggable, fixed-positioned), help popups, the welcome modal.

### Use of transparency / blur
- Transparency: only as low-opacity color tints on flat surfaces (see Color above). No backdrop blur. No frosted glass. No translucent overlays.

### Corner radii
- Tight: 3 / 4 / 6 / 7 / 10px. The default radius is 3–4px. The largest element (welcome modal) is 10px. Buttons are 4px. Mem cells, chips, inputs are 3px.
- Nothing is fully rounded (no pills, no circles for chips).

### Cards
- Panels are the closest thing to "cards":
  - `1px` border in `--border`.
  - `--bg1` body, `--bg2` header strip.
  - **No drop-shadow on regular panels.** Only floating windows (calculator, modal, dropdowns) get shadow.
  - Headers are 24px tall, mono caps centered text with optional emoji icon.

### Density
- *Very* dense. Vertical padding inside rows is typically 1–2px; horizontal padding 6–10px. This is intentional — the simulator is meant to show as much CPU state as possible at once.

---

## ICONOGRAPHY

The product uses **three distinct icon sources** depending on context:

1. **Unicode glyphs as toolbar/inline icons.** Most "icons" in the live app are typed unicode chars rendered in the same font as text. This is the dominant approach.
   - Run/Stop: `▶`/`■`   Build: `⚙`   Step: `↓`   Step Over: `↷`   Step Out: `↵`   Back: `⟲`   Reset: `↺`
   - Memory paging: `«` `»` `▲` `▼`
   - Legend swatches: `■` (colored)
   - Settings: `⚙`   Help: `?` (in an amber bordered button)
   - Status icons: `▶` (running), `⏸` (halted), `■` (stopped), `✕` (error)
   - **Never substitute these with SVG icon-set icons** — the unicode rendering is part of the look.

2. **Emoji as panel-header glyphs.** A small fixed set, never used in prose:
   - 💡 LED Display
   - 🧠 CPU State (welcome modal feature card)
   - 💾 Memory
   - 🔔 Interrupts
   - 🔌 I/O & Keyboard
   - 📝 Editor (welcome modal)
   - These ride in `.panel-icon` — 13px, no letter-spacing, sitting before the panel title.

3. **A custom inline SVG sprite** at `assets/social-icons.svg` (`web/public/icons.svg`) for footer/brand-menu social links. Symbols: `bluesky-icon`, `discord-icon`, `documentation-icon`, `github-icon`, `social-icon`, `x-icon`. Used via `<svg><use href="…/icons.svg#github-icon"/></svg>`. These are *only* inside the brand dropdown menu, not in the workspace.

4. **The favicon / brand mark** is a hand-drawn 8-bit-style "8085" rendered as 2px-grid-aligned `<rect>` elements in `--accent` green on a `--bg2` rounded square (3px radius, `--border` stroke). It is the entire visual identity — there is no full logo, no wordmark beyond the green "8085" capsule chip in the topbar.

5. **The 7-segment LED digit** is a custom inline SVG component (`SevenSeg`) in `App.jsx`. Eight `<path>` elements (segments a–g + decimal point) over a 17×23 viewBox, lit segments fill `#FF2200` and unlit segments fill `rgba(255,34,0,0.15)`. The whole `<svg>` gets a red glow drop-shadow. Treat this as a **brand asset** — recreate it pixel-for-pixel; do not improvise a different 7-seg shape.

**Substitution policy.**
- ✅ Use the unicode chars and emoji as listed above.
- ✅ Use the supplied SVG sprite for social.
- ❌ Do **not** introduce Lucide / Heroicons / Material / Phosphor or any third-party icon set — the codebase uses none.
- ❌ Do not redraw the favicon "85" or the SevenSeg in a stylized way; copy them as-is.

No PNG icons are used anywhere. No icon font is loaded.

---

## UI Kits

- **`ui_kits/sim8085/`** — recreation of the simulator workspace as a clickable click-thru: topbar with brand chip + run controls, three-column workspace with editor / disassembly / registers / memory / LED display / flags / interrupts. Components are factored so any view can be reassembled.
