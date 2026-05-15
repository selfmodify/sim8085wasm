# Handoff: sim8085 Design System

## Overview

This package contains the design system and reference UI kit for **sim8085** — a single-page web app that ports the original 1995 DOS-era 8085 microprocessor simulator by Vijay Kumar to a modern web platform. The aesthetic is unapologetically **retro-terminal**: dark slate background, terminal green primary, amber/red signal colors, monospace-forward typography, dense panels with thin borders.

The system was reverse-engineered from the source repo [`selfmodify/sim8085`](https://github.com/selfmodify/sim8085) and codifies the visual + content rules so any new surface (in-app feature, marketing snippet, doc page, screenshot) reads as part of the same product.

## About the Design Files

The files in this bundle are **design references created in HTML/JSX** — prototypes showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (the sim8085 source app uses React + Vite, but you should follow whatever patterns and libraries the live codebase uses) — pulling the tokens, type rules, copy voice, and component structure across faithfully.

If the destination is a **fresh codebase**, React + Vite + plain CSS variables (no styled-components, no Tailwind in the existing source) is the closest match to the original product.

## Fidelity

**High-fidelity (hifi).** All colors, type sizes, spacing, radii, and shadows are pinned to exact values in `tokens/colors_and_type.css`. The UI kit (`ui_kit/`) is a clickable recreation of the simulator workspace at production fidelity. Recreate pixel-for-pixel using the codebase's existing libraries.

## How to Use This Package

1. **Read `DESIGN_SYSTEM.md` first.** It is the authoritative document — voice, casing, color semantics, iconography substitution policy, layout, density rules. Every claim in this README is derived from it.
2. **Drop `tokens/colors_and_type.css` into the target codebase.** It defines every CSS variable used downstream. All component styles reference these tokens — never hardcode a hex or px value that exists as a token.
3. **Use `ui_kit/` as the structural reference.** `index.html` boots a Babel-transpiled JSX recreation of the full workspace. `components.jsx` factors out reusable atoms (Button, Panel, Reg, Flag, MemCell, etc.). `seven-seg.jsx` is the iconic LED digit — recreate this pixel-for-pixel; do not improvise.
4. **Match the copy voice exactly.** Direct, technical, second-person, zero marketing fluff. See "Content Fundamentals" in `DESIGN_SYSTEM.md`.

## Files in This Bundle

```
design_handoff_sim8085_design_system/
├── README.md                          # this file — start here
├── DESIGN_SYSTEM.md                   # full design system spec (the source of truth)
├── tokens/
│   └── colors_and_type.css            # all CSS variables + base type classes
├── assets/
│   ├── favicon.svg                    # 8-bit-style "8085" mark (rect-grid)
│   ├── favicon.ico
│   ├── social-icons.svg               # SVG sprite: bluesky, github, x, discord, social, docs
│   └── hero.png                       # welcome-modal hero image
└── ui_kit/
    ├── README.md                      # kit-specific notes
    ├── index.html                     # bootable preview of the recreated workspace
    ├── app.jsx                        # top-level app composition
    ├── components.jsx                 # Button, Panel, Reg, Flag, MemCell, Topbar, etc.
    ├── seven-seg.jsx                  # the iconic 7-segment LED digit
    └── styles.css                     # component CSS (consumes tokens)
```

## Design Tokens (Quick Reference)

The full token set lives in `tokens/colors_and_type.css`. Highlights:

### Surfaces (dark stack — lowest = deepest)
- `--bg`   `#0d0f14` — page / outermost
- `--bg1`  `#141720` — panel body
- `--bg2`  `#1a1e2b` — panel header / button rest
- `--bg3`  `#20253a` — panel header hover / chip / input

### Borders
- `--border`  `#2a3050` — default 1px panel/cell border
- `--border2` `#3a4568` — hover / focused border

### Brand + signal
- `--accent`  `#4af0a0` — terminal green: live / current / correct / primary CTA
- `--accent2` `#2ac878` — darker green hover
- `--amber`   `#f0a840` — attention: SP, pending interrupts, halted, hex toggle
- `--red`     `#ff4040` — stop, error, breakpoint, destructive (never decorative)
- `--blue`    `#4090ff` — secondary action: Build button, mnemonics
- `--led-on`  `#FF2200` — 7-segment LED illuminated only

### Text ramp
- `--text`  `#c8d4e8` — primary
- `--text2` `#7888a8` — secondary / labels
- `--text3` `#4a5470` — tertiary / disabled / hints

### Type
- **Mono**: `JetBrains Mono` → `Fira Code` → `Cascadia Code` → system. ~80% of visible text.
- **Sans**: `IBM Plex Sans`. Prose only — modal body, help, chat copy.
- Sizes are aggressive and small: **9px** section headers · **11px** panel headers/tags · **12–13px** rows · **14px** register values · **16px** brand chip.
- **Letter-spacing is the texture**: headers `2px`, sub-headers `1.5px`. Numbers and code never tracked.

### Radii (small, restrained)
- `3px` mem cells / inputs / chips
- `4px` buttons / brand chip
- `6px` floating windows / popups
- `7px` dropdown menus
- `10px` welcome modal (largest in the system)

### Shadows
- `--shadow-pop`   `0 4px 16px rgba(0,0,0,.5)` — context menus, tooltips
- `--shadow-menu`  `0 8px 24px rgba(0,0,0,.6)` — dropdowns
- `--shadow-modal` `0 12px 40px rgba(0,0,0,.7)` — welcome modal
- `--shadow-led`   `drop-shadow(0 0 5px rgba(255,40,0,.8))` — LED only
- **Panels themselves cast no shadow.** Only floating elements.

### Spacing rhythm
`2 / 4 / 6 / 8 / 10 / 14 / 16 / 24px`. The app stays tight; few large gaps. Vertical row padding 1–2px, horizontal 6–10px.

## Iconography — Substitution Policy

The app uses **three distinct icon sources**; do not introduce a fourth.

1. **Unicode glyphs** for toolbar/inline icons (Run `▶`, Build `↓`, Step `↻`/`▼`, Back `⌂`, Reset `↻`, Memory paging `«` `»` `▲` `▼`, Settings `⚙`, Help `?`, Status `▶` running / `⏸` halted / `✕` error). **Do not replace with SVG icon sets.**
2. **Emoji** as panel-header glyphs only — fixed set: 💡 LED · 🧠 CPU · 💾 Memory · 🔔 Interrupts · 🔌 I/O · 📝 Editor. Never used in prose.
3. **Custom SVG sprite** at `assets/social-icons.svg` — for footer/brand-menu social links only.

❌ Do **not** introduce Lucide / Heroicons / Material / Phosphor or any third-party icon set.
❌ Do **not** redraw the `favicon.svg` "8085" or the `seven-seg.jsx` LED digit in a stylized way — copy them as-is.

## Layout Constraints

- **Three columns, full viewport height.** No max-width, no centering. Edge-to-edge.
- **Topbar**: fixed `60px` slab with brand chip + Examples menu + run controls (Build · Step · Back · Run · Reset · Speed slider).
- **Columns**: 340px editor (min 180) · flex center (min 280) · 300px right (min 200). Draggable to resize via 4px `ew-resize` handles.
- **Floating only**: dropdown menus, calculator window, help popups, welcome modal. Nothing else floats.

## Animation Budget

Three motion primitives, full stop:
1. `transition: all .12s` on hover for buttons.
2. `blink 1s infinite` (opacity 1↔.5) on running status text.
3. `pc-flash .35s ease-out` — current disassembly row briefly brightens green when PC moves.

No bounces, springs, sliding panels, fade-in mounts. Nothing scales or rotates.

## Voice & Copy Rules

- **Direct, technical, second-person ("you").** Zero marketing fluff. Reads like manpages.
- **Casing**: panel headers `ALL CAPS` mono 11px tracked 2px · sub-section headers `ALL CAPS` mono 9px tracked 1.5px · buttons Title Case for verbs (`Build`, `Step`, `Run`) and `ALL CAPS` for hardware-style toggles (`FIRE`, `OFF`, `HEX`) · body/help/modal in Sentence case.
- **Pronouns**: always "you", never "we".
- **Abbreviations are first-class.** The audience knows `PC`, `SP`, `IFF`, `RST 7.5`, `AC`, `CY`. Never expand inline. Help popups `?` expand on demand.
- **Mechanical, not friendly.** No exclamation marks except inside error strings. No "Let's…", no "Awesome!".

See `DESIGN_SYSTEM.md` § "Content Fundamentals" for verbatim copy examples.

## Density

Very dense — intentionally. Vertical row padding 1–2px, horizontal 6–10px. The simulator is meant to show as much CPU state as possible at once. Do not loosen this.

## What's Out of Scope for This System

- No marketing site, docs site, or mobile app — the entire surface is the in-app experience.
- No images, gradients, textures, glassmorphism, blur, or full-bleed photography.
- No icon fonts. No PNG icons.
- No max-widths, no centered containers.

## Source

The original codebase is at [`selfmodify/sim8085`](https://github.com/selfmodify/sim8085) on the `main` branch. The design system in `DESIGN_SYSTEM.md` was reverse-engineered from `web/src/App.css` (1297 lines) and `web/src/App.jsx` (2595 lines). When the system and the source disagree, **the source wins** — file an issue and update the system to match.
