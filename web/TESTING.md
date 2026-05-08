# Testing Guide

## Overview

The test suite covers four layers of the application:

| Layer | File | What it tests |
|---|---|---|
| Utilities | `src/utils.test.js` | Pure helper functions: hex formatting, base conversion, flag evaluation |
| Simulator core | `src/sim8085.test.js` | Every 8085 instruction group, flags, stack, I/O, cycle counting |
| User journeys | `src/userJourneys.test.js` | End-to-end flows: assemble → run → inspect, breakpoints, memory editing |
| React hooks | `src/hooks.test.js` | `useCollapsible` (localStorage persistence, toggle), `useCopy` (timer, clipboard) |
| UI components | `src/components.test.jsx` | Panel render, user interactions: FlagPanel, ConsolePanel, TracePanel, CallStackPanel, WatchPanel, CalcFloat |

---

## Running Tests

```bash
# Run all tests once (CI mode)
npm test

# Watch mode — re-runs on file change
npm run test:watch

# Coverage report (generates ./coverage/)
npm run test:coverage
```

All commands run from the `web/` directory.

---

## Test Infrastructure

**Framework**: [Vitest](https://vitest.dev/) with `happy-dom` as the browser environment.

**Component testing**: [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro/) + [@testing-library/jest-dom](https://github.com/testing-library/jest-dom) for DOM assertions.

**Setup file** (`vitest.setup.js`):
- Extends `expect` with jest-dom matchers (`toBeInTheDocument`, `toHaveClass`, etc.)
- Calls `cleanup()` after every test to unmount React trees
- Stubs `navigator.clipboard` so `useCopy` works in happy-dom

**Vitest config** (in `vite.config.js` under `test:`):
```js
test: {
  globals: true,
  environment: 'happy-dom',
  setupFiles: ['./vitest.setup.js'],
  exclude: ['node_modules', 'dist', '**/*.puppeteer.js'],
}
```

---

## Simulator Tests (`sim8085.test.js`, `userJourneys.test.js`)

These tests import `sim8085Bridge.js` directly — **not** through `simProxy.js`. This bypasses the WASM bridge entirely, so no build step is needed.

### Key pattern

```js
import { simInit, simAssemble, simStep, simGetRegisters, simIsRunning } from './sim8085Bridge.js';

beforeEach(() => { simInit(); }); // resets all global state

function run(code, maxSteps = 500) {
  simInit();
  const res = simAssemble(code);
  if (!res.ok) throw new Error(`Assembly failed: ${res.errorMsg}`);
  while (simIsRunning() && maxSteps-- > 0) simStep();
  return simGetRegisters();
}
```

`simInit()` must be called before each test — `sim8085Bridge.js` uses module-level mutable state. The `beforeEach` hook handles this automatically.

### Flag bit accessors

```js
const CY  = r => r.flags & 0x01;
const P   = r => (r.flags >> 2) & 1;
const AC  = r => (r.flags >> 4) & 1;
const Z   = r => (r.flags >> 6) & 1;
const S   = r => (r.flags >> 7) & 1;
```

---

## Component Tests (`components.test.jsx`)

### simProxy mock

`simProxy.js` is mocked globally at the top of the file so components that call `sim.simReadByte()` don't require a live simulator:

```js
vi.mock('./simProxy.js', () => ({
  simReadByte: vi.fn(() => 0),
  simWriteByte: vi.fn(),
  simGetMemory: vi.fn(() => new Uint8Array(0x10000)),
}));
```

### SimulatorContext helper

Several panels (`WatchPanel`, `RegPanel`, etc.) consume `SimulatorContext`. A `withCtx()` helper wraps renders:

```jsx
function withCtx(ui, ctxOverrides = {}) {
  const defaults = { regBase: 'hex', onRegBase: vi.fn(), onEdit: vi.fn(), onShowDialog: vi.fn() };
  return render(
    <SimulatorContext.Provider value={{ ...defaults, ...ctxOverrides }}>
      {ui}
    </SimulatorContext.Provider>
  );
}
```

### Collapsible panels

Panels that use `useCollapsible` default to their stored state (or `defaultCollapsed` when localStorage is empty). Most panels start collapsed in tests because no localStorage key is set. Click the panel header to expand before asserting on panel body content.

---

## Hook Tests (`hooks.test.js`)

`useCollapsible` tests use `localStorage.clear()` in `beforeEach` to isolate storage between tests. `useCopy` tests use `vi.useFakeTimers()` to control the 1200 ms reset timeout without real delays.

---

## Adding New Tests

1. **New utility function** → add a `describe` block in `utils.test.js`.
2. **New 8085 instruction** → add a case in `sim8085.test.js` following the `run()` helper pattern.
3. **New user-facing flow** → add a journey in `userJourneys.test.js`.
4. **New component** → add a `describe` block in `components.test.jsx`; mock any external dependencies with `vi.mock`.
5. **New hook** → add a `describe` block in `hooks.test.js`; use `renderHook` from `@testing-library/react`.

---

## Coverage Targets

| Area | Target |
|---|---|
| `utils.js` | 100% — pure functions, fully deterministic |
| `sim8085Bridge.js` | >80% line coverage of instruction dispatch |
| Hooks | 100% branch coverage |
| Components | Happy-path render + key interactions per panel |

Run `npm run test:coverage` to see the current report in `./coverage/index.html`.
