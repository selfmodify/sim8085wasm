# sim8085 — UI Kit

A clickable, hi-fi recreation of the sim8085 web simulator workspace. Open `index.html` in a browser to see the simulator in action — it ships pre-loaded with the *LED Count* example and a few sample run states you can switch between.

## What's here

- **`index.html`** — entry point. Loads React 18 + Babel + the components below.
- **`components.jsx`** — `Topbar`, `Panel`, `Btn`, `Reg`, `RegPair`, `Flag`, `IntRow`, `MemGrid`, `Disasm`, `LEDStrip`, `StatusBar`, plus a few small helpers.
- **`seven-seg.jsx`** — the iconic 7-segment LED digit, copied byte-for-byte from `App.jsx`.
- **`app.jsx`** — wires it all together as a click-thru: Run / Step buttons advance a canned trace.

The kit imports `../../colors_and_type.css` so all design tokens stay in sync with the system root.

## What it covers

Three-column workspace (340 / flex / 300 px), 60px topbar with brand chip + run controls, status bar at the bottom. Editor column shows a syntax-highlighted assembly snippet (rendered as plain spans — not a real CodeMirror instance) and the LED display. Center column has live disassembly + hex memory editor. Right column has registers, register pairs, flags, and interrupt FIRE buttons.

## What it doesn't

- The assembler is faked — Build/Run cycles through pre-recorded states.
- No real CodeMirror, no editing the assembly source.
- No AI Assistant panel, no I/O ports panel, no watch list (visible in screenshots, omitted here for component focus).
- No memory editing or breakpoints.
