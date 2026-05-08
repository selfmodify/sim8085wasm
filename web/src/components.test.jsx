/**
 * components.test.jsx
 * Render and behaviour tests for UI panel components.
 * simProxy is mocked so tests run without WASM or live simulator state.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SimulatorContext } from './SimulatorContext.jsx';

// ── simProxy mock ─────────────────────────────────────────────────────────────
vi.mock('./simProxy.js', () => ({
  simReadByte: vi.fn(() => 0),
  simWriteByte: vi.fn(),
  simGetMemory: vi.fn(() => new Uint8Array(0x10000)),
  simDisassemble: vi.fn((addr) => ({
    text: `${addr.toString(16).padStart(4, '0').toUpperCase()} 76   HLT`,
    len: 1, cycles: 7, mnem: 'HLT',
  })),
  simSetRegisters: vi.fn(),
}));

// Access the mocked simProxy functions for per-test configuration
import * as simProxyMock from './simProxy.js';

// Clear localStorage before each test so useCollapsible starts fresh
beforeEach(() => { localStorage.clear(); });

// ── Context helper ────────────────────────────────────────────────────────────
function withCtx(ui, ctxOverrides = {}) {
  const defaults = {
    regBase: 'hex',
    onRegBase: vi.fn(),
    onEdit: vi.fn(),
    onShowDialog: vi.fn(),
  };
  return render(
    <SimulatorContext.Provider value={{ ...defaults, ...ctxOverrides }}>
      {ui}
    </SimulatorContext.Provider>
  );
}

// ── FlagPanel ─────────────────────────────────────────────────────────────────
import { FlagPanel } from './FlagPanel.jsx';

describe('FlagPanel', () => {
  const baseRegs = { flagS: 0, flagZ: 0, flagAC: 0, flagP: 0, flagCY: 0 };

  it('renders all five flag labels', () => {
    render(<FlagPanel regs={baseRegs} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    ['S', 'Z', 'AC', 'P', 'CY'].forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('shows flag value 0 when all flags clear', () => {
    render(<FlagPanel regs={baseRegs} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    // Panel starts expanded (defaultCollapsed=false, no localStorage entry)
    expect(document.querySelector('.flags-row')).not.toBeNull();
    const vals = document.querySelectorAll('.flag-val');
    expect(vals.length).toBe(5);
    vals.forEach(v => expect(v.textContent).toBe('0'));
  });

  it('shows flag-on class for set flags', () => {
    const setRegs = { ...baseRegs, flagZ: 1, flagCY: 1 };
    render(<FlagPanel regs={setRegs} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    // Panel starts expanded (defaultCollapsed=false) — no click needed
    const flagDivs = document.querySelectorAll('.flag');
    const onFlags = [...flagDivs].filter(d => d.classList.contains('flag-on'));
    expect(onFlags.length).toBe(2);
  });

  it('collapses and expands on header click', () => {
    render(<FlagPanel regs={baseRegs} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    // Panel starts expanded (defaultCollapsed=false)
    expect(document.querySelector('.flags-row')).not.toBeNull();
    // Click to collapse
    fireEvent.click(screen.getByText('FLAGS'));
    expect(document.querySelector('.flags-row')).toBeNull();
    // Click to expand again
    fireEvent.click(screen.getByText('FLAGS'));
    expect(document.querySelector('.flags-row')).not.toBeNull();
  });
});

// ── ConsolePanel ──────────────────────────────────────────────────────────────
import { ConsolePanel } from './ConsolePanel.jsx';

describe('ConsolePanel', () => {
  it('shows placeholder when output is empty', () => {
    render(<ConsolePanel output="" port={1} onSetPort={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText(/No output yet/)).toBeInTheDocument();
  });

  it('renders console output lines', () => {
    render(<ConsolePanel output={'hello\nworld'} port={1} onSetPort={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('calls onClear when ✕ is clicked', () => {
    const onClear = vi.fn();
    render(<ConsolePanel output="text" port={1} onSetPort={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByTitle('Clear console output'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('displays port number as hex in the input', () => {
    render(<ConsolePanel output="" port={0x1F} onSetPort={vi.fn()} onClear={vi.fn()} />);
    const input = screen.getByRole('textbox');
    expect(input.value).toBe('1F');
  });

  it('calls onSetPort with parsed value on Enter', () => {
    const onSetPort = vi.fn();
    render(<ConsolePanel output="" port={1} onSetPort={onSetPort} onClear={vi.fn()} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '05' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSetPort).toHaveBeenCalledWith(5);
  });

  it('calls onSetPort on blur', () => {
    const onSetPort = vi.fn();
    render(<ConsolePanel output="" port={1} onSetPort={onSetPort} onClear={vi.fn()} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '0A' } });
    fireEvent.blur(input);
    expect(onSetPort).toHaveBeenCalledWith(10);
  });
});

// ── TracePanel ────────────────────────────────────────────────────────────────
import { TracePanel } from './TracePanel.jsx';

describe('TracePanel', () => {
  it('shows empty message when trace is empty (after expand)', () => {
    render(<TracePanel trace={[]} onClear={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    // TracePanel defaults to collapsed; click to expand
    fireEvent.click(screen.getByText('TRACE'));
    expect(screen.getByText(/Step or run to record/)).toBeInTheDocument();
  });

  it('renders trace entries after expanding', () => {
    const trace = [
      { addr: 0x100, text: '0100 3E 01   MVI A,01H', changedKeys: [], regs: {} },
      { addr: 0x102, text: '0102 76   HLT', changedKeys: [], regs: {} },
    ];
    render(<TracePanel trace={trace} onClear={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(screen.getByText('TRACE'));
    // trace-text spans strip the address+hex prefix, leaving just the mnemonic
    const rows = document.querySelectorAll('.trace-text');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('MVI A,01H');
    expect(rows[1].textContent).toContain('HLT');
  });

  it('shows address for each trace entry', () => {
    const trace = [
      { addr: 0x0200, text: '0200 00   NOP', changedKeys: [], regs: {} },
    ];
    render(<TracePanel trace={trace} onClear={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(screen.getByText('TRACE'));
    expect(screen.getByText('0200')).toBeInTheDocument();
  });

  it('calls onClear when ✕ button is clicked', () => {
    const onClear = vi.fn();
    render(<TracePanel trace={[]} onClear={onClear} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(screen.getByTitle('Clear trace'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('shows register changes in trace deltas', () => {
    const trace = [{
      addr: 0x100, text: '0100 3E 05   MVI A,05H',
      changedKeys: ['a'],
      regs: { a: 5 },
    }];
    render(<TracePanel trace={trace} onClear={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(screen.getByText('TRACE'));
    // Changed register A=05 should appear in the trace delta span
    const delta = document.querySelector('.trace-delta');
    expect(delta).not.toBeNull();
    expect(delta.textContent).toContain('A=05');
  });
});

// ── CallStackPanel ────────────────────────────────────────────────────────────
import { CallStackPanel } from './CallStackPanel.jsx';

describe('CallStackPanel', () => {
  it('shows empty message when call stack is empty (after expand)', () => {
    render(<CallStackPanel callStack={[]} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(screen.getByText('CALL STACK'));
    expect(screen.getByText(/empty/)).toBeInTheDocument();
  });

  it('renders a call stack frame', () => {
    const stack = [{ targetAddr: 0x0200, callAddr: 0x0103, retAddr: 0x0106 }];
    render(<CallStackPanel callStack={stack} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(screen.getByText('CALL STACK'));
    const targets = document.querySelectorAll('.callstack-target');
    const sites = document.querySelectorAll('.callstack-site');
    expect(targets[0].textContent).toBe('0200H');
    expect(sites[0].textContent).toBe('0103H');
  });

  it('shows call stack depth count in header', () => {
    const stack = [
      { targetAddr: 0x200, callAddr: 0x100, retAddr: 0x103 },
      { targetAddr: 0x300, callAddr: 0x205, retAddr: 0x208 },
    ];
    render(<CallStackPanel callStack={stack} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls onJump with targetAddr when frame target is clicked', () => {
    const onJump = vi.fn();
    const stack = [{ targetAddr: 0x0200, callAddr: 0x0103, retAddr: 0x0106 }];
    render(<CallStackPanel callStack={stack} onJump={onJump} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(screen.getByText('CALL STACK'));
    fireEvent.click(screen.getByTitle('Target address'));
    expect(onJump).toHaveBeenCalledWith(0x0200);
  });
});

// ── WatchPanel ────────────────────────────────────────────────────────────────
import { WatchPanel } from './WatchPanel.jsx';

const baseRegs8 = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0xFFFF, flags: 0 };

describe('WatchPanel', () => {
  it('shows empty message when watches list is empty', () => {
    withCtx(<WatchPanel watches={[]} regs={baseRegs8} onAdd={vi.fn()} onRemove={vi.fn()} dataBps={new Set()} onToggleBreak={vi.fn()} />);
    expect(screen.getByText(/Type a register or address/)).toBeInTheDocument();
  });

  it('renders a register watch', () => {
    const watches = [{ type: 'reg', key: 'a' }];
    withCtx(<WatchPanel watches={watches} regs={{ ...baseRegs8, a: 0xAB }} onAdd={vi.fn()} onRemove={vi.fn()} dataBps={new Set()} onToggleBreak={vi.fn()} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('AB')).toBeInTheDocument();
  });

  it('renders a memory watch', () => {
    simProxyMock.simReadByte.mockReturnValue(0x55);
    const watches = [{ type: 'mem', addr: 0x0300 }];
    withCtx(<WatchPanel watches={watches} regs={baseRegs8} onAdd={vi.fn()} onRemove={vi.fn()} dataBps={new Set()} onToggleBreak={vi.fn()} />);
    expect(screen.getByText('0300H')).toBeInTheDocument();
    // Memory is shown as 16-bit word: fmtWord(0x55, 'hex') = '0055'
    expect(screen.getByText('0055')).toBeInTheDocument();
  });

  it('calls onRemove with correct index when ✕ is clicked', () => {
    const onRemove = vi.fn();
    const watches = [{ type: 'reg', key: 'b' }, { type: 'reg', key: 'c' }];
    withCtx(<WatchPanel watches={watches} regs={baseRegs8} onAdd={vi.fn()} onRemove={onRemove} dataBps={new Set()} onToggleBreak={vi.fn()} />);
    const removeButtons = screen.getAllByText('✕');
    fireEvent.click(removeButtons[1]); // remove second item
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('calls onAdd with reg object when Enter pressed on register name', () => {
    const onAdd = vi.fn();
    withCtx(<WatchPanel watches={[]} regs={baseRegs8} onAdd={onAdd} onRemove={vi.fn()} dataBps={new Set()} onToggleBreak={vi.fn()} />);
    const input = screen.getByPlaceholderText(/A.*BC.*0200H/);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith({ type: 'reg', key: 'a' });
  });

  it('calls onAdd with mem object when Enter pressed on a hex address', () => {
    const onAdd = vi.fn();
    withCtx(<WatchPanel watches={[]} regs={baseRegs8} onAdd={onAdd} onRemove={vi.fn()} dataBps={new Set()} onToggleBreak={vi.fn()} />);
    const input = screen.getByPlaceholderText(/A.*BC.*0200H/);
    fireEvent.change(input, { target: { value: '200H' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith({ type: 'mem', addr: 0x200 });
  });

  it('shows W button with active class for watched memory address with breakpoint', () => {
    const watches = [{ type: 'mem', addr: 0x300 }];
    const dataBps = new Set([0x300]);
    withCtx(<WatchPanel watches={watches} regs={baseRegs8} onAdd={vi.fn()} onRemove={vi.fn()} dataBps={dataBps} onToggleBreak={vi.fn()} />);
    const wBtn = screen.getByText('W');
    expect(wBtn.classList.contains('active')).toBe(true);
  });
});

// ── MemMapPanel ───────────────────────────────────────────────────────────────
import { MemMapPanel } from './MemMapPanel.jsx';

describe('MemMapPanel', () => {
  const baseRegsM = { pc: 0x100, sp: 0 };

  it('renders MEMORY MAP header', () => {
    render(<MemMapPanel regs={baseRegsM} programRegion={null} presetAddrs={new Set()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(screen.getByText(/MEMORY MAP/)).toBeInTheDocument();
  });

  it('starts expanded and shows default info text', () => {
    render(<MemMapPanel regs={baseRegsM} programRegion={null} presetAddrs={new Set()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(screen.getByText('Click a region for details')).toBeInTheDocument();
  });

  it('collapses and expands on header click', () => {
    render(<MemMapPanel regs={baseRegsM} programRegion={null} presetAddrs={new Set()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(screen.getByText('Click a region for details')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.queryByText('Click a region for details')).toBeNull();
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.getByText('Click a region for details')).toBeInTheDocument();
  });

  it('renders code region when programRegion provided', () => {
    render(<MemMapPanel regs={baseRegsM} programRegion={{ start: 0x100, end: 0x200 }} presetAddrs={new Set()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(document.querySelector('.memmap-code')).not.toBeNull();
  });

  it('clicking code region updates selected info text', () => {
    render(<MemMapPanel regs={baseRegsM} programRegion={{ start: 0x100, end: 0x200 }} presetAddrs={new Set()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(document.querySelector('.memmap-code'));
    expect(screen.getByText(/Code: 0100H/)).toBeInTheDocument();
  });

  it('renders stack region when sp > 0', () => {
    render(<MemMapPanel regs={{ pc: 0x100, sp: 0xF000 }} programRegion={null} presetAddrs={new Set()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(document.querySelector('.memmap-stack')).not.toBeNull();
  });

  it('clicking stack region updates selected info text', () => {
    render(<MemMapPanel regs={{ pc: 0x100, sp: 0xF000 }} programRegion={null} presetAddrs={new Set()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    fireEvent.click(document.querySelector('.memmap-stack'));
    expect(screen.getByText(/Stack: F000H/)).toBeInTheDocument();
  });

  it('shows legend labels CODE, DATA, STACK, PC', () => {
    render(<MemMapPanel regs={baseRegsM} programRegion={null} presetAddrs={new Set()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    ['CODE', 'DATA', 'STACK', 'PC'].forEach(label => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});

// ── IOPortPanel ───────────────────────────────────────────────────────────────
import { IOPortPanel } from './IOPortPanel.jsx';

const baseIOProps = {
  outputPorts: [], inputPresets: [],
  onSetInput: vi.fn(), onRemoveInput: vi.fn(),
  keyQueue: [], onEnqueueKeys: vi.fn(), onClearKeyQueue: vi.fn(),
  sid: 0, sod: 0, onSetSID: vi.fn(),
  dragHandleProps: {}, dropTargetProps: {}, isDragOver: false,
};

describe('IOPortPanel', () => {
  it('starts collapsed', () => {
    render(<IOPortPanel {...baseIOProps} />);
    expect(screen.queryByText('No OUT executed yet')).toBeNull();
  });

  it('shows empty messages after expanding', () => {
    render(<IOPortPanel {...baseIOProps} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.getByText('No OUT executed yet')).toBeInTheDocument();
    expect(screen.getByText('No input ports set')).toBeInTheDocument();
  });

  it('renders output port entries', () => {
    render(<IOPortPanel {...baseIOProps} outputPorts={[{ port: 0x10, val: 0xFF }]} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.getByText('10H')).toBeInTheDocument();
    expect(screen.getByText('FFH')).toBeInTheDocument();
  });

  it('calls onSetInput when port and value entered then Enter pressed', () => {
    const onSetInput = vi.fn();
    render(<IOPortPanel {...baseIOProps} onSetInput={onSetInput} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    fireEvent.change(screen.getByPlaceholderText('port (hex)'), { target: { value: '05' } });
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'FF' } });
    fireEvent.keyDown(screen.getByPlaceholderText('value'), { key: 'Enter' });
    expect(onSetInput).toHaveBeenCalledWith(5, 255);
  });

  it('calls onRemoveInput when ✕ clicked on input preset', () => {
    const onRemoveInput = vi.fn();
    render(<IOPortPanel {...baseIOProps} inputPresets={[{ port: 0x05, val: 0x10 }]} onRemoveInput={onRemoveInput} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    fireEvent.click(screen.getByText('✕'));
    expect(onRemoveInput).toHaveBeenCalledWith(5);
  });

  it('SID button reflects current state and calls onSetSID on click', () => {
    const onSetSID = vi.fn();
    render(<IOPortPanel {...baseIOProps} sid={0} onSetSID={onSetSID} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    const sidBtn = screen.getByTitle('Toggle Serial Input Data line');
    expect(sidBtn.textContent).toBe('0');
    fireEvent.click(sidBtn);
    expect(onSetSID).toHaveBeenCalledWith(1);
  });

  it('shows keyboard queue characters', () => {
    render(<IOPortPanel {...baseIOProps} keyQueue={['A', 'B']} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('calls onClearKeyQueue when keyboard ✕ clicked', () => {
    const onClearKeyQueue = vi.fn();
    render(<IOPortPanel {...baseIOProps} keyQueue={['X']} onClearKeyQueue={onClearKeyQueue} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    fireEvent.click(screen.getByTitle('Clear queue'));
    expect(onClearKeyQueue).toHaveBeenCalledOnce();
  });
});

// ── InterruptPanel ────────────────────────────────────────────────────────────
import { InterruptPanel } from './InterruptPanel.jsx';

const baseIntState = {
  iff: 0, intMask: 0, rst75ff: false, trapPend: false,
  rst65: false, rst55: false, intr: false,
};
const intProps = { onAssert: vi.fn(), onDeassert: vi.fn(), dragHandleProps: {}, dropTargetProps: {}, isDragOver: false };

describe('InterruptPanel', () => {
  it('starts collapsed', () => {
    render(<InterruptPanel intState={baseIntState} {...intProps} />);
    expect(screen.queryByText('DISABLED')).toBeNull();
  });

  it('shows IFF DISABLED when iff=0', () => {
    render(<InterruptPanel intState={baseIntState} {...intProps} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
  });

  it('shows IFF ENABLED when iff=1', () => {
    render(<InterruptPanel intState={{ ...baseIntState, iff: 1 }} {...intProps} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.getByText('ENABLED')).toBeInTheDocument();
  });

  it('shows FIRE buttons for pulse interrupts TRAP and RST 7.5', () => {
    render(<InterruptPanel intState={baseIntState} {...intProps} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.getAllByText('FIRE').length).toBe(2);
  });

  it('calls onAssert with TRAP when FIRE clicked for TRAP', () => {
    const onAssert = vi.fn();
    render(<InterruptPanel intState={baseIntState} {...intProps} onAssert={onAssert} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    fireEvent.click(screen.getByRole('button', { name: /Fire TRAP/ }));
    expect(onAssert).toHaveBeenCalledWith('TRAP');
  });

  it('calls onDeassert when ON level-interrupt clicked', () => {
    const onDeassert = vi.fn();
    render(<InterruptPanel intState={{ ...baseIntState, rst65: true }} {...intProps} onDeassert={onDeassert} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    fireEvent.click(screen.getByRole('button', { name: /RST 6.5 interrupt: ON/ }));
    expect(onDeassert).toHaveBeenCalledWith('RST65');
  });

  it('shows masked tag when interrupt mask bit is set for RST55', () => {
    render(<InterruptPanel intState={{ ...baseIntState, intMask: 0b001 }} {...intProps} />);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(screen.getByText('masked')).toBeInTheDocument();
  });
});

// ── DisasmPanel ───────────────────────────────────────────────────────────────
import { DisasmPanel } from './DisasmPanel.jsx';

const baseDisasmProps = {
  regs: { pc: 0x100 },
  breakpoints: new Map(),
  onToggleBp: vi.fn(), onClearAllBps: vi.fn(),
  onSetCondition: vi.fn(), onGotoLine: vi.fn(),
  buildId: 1, pcFlash: 0,
  onRunTo: vi.fn(), symbols: {}, onJumpMem: vi.fn(),
  hitcnts: new Map(), maxHit: 0,
};

describe('DisasmPanel', () => {
  it('renders DISASSEMBLY header', () => {
    render(<DisasmPanel {...baseDisasmProps} />);
    expect(screen.getByText(/DISASSEMBLY/)).toBeInTheDocument();
  });

  it('renders disassembly rows', () => {
    render(<DisasmPanel {...baseDisasmProps} />);
    expect(document.querySelectorAll('.disasm-row').length).toBeGreaterThan(0);
  });

  it('shows PC arrow on the current address row', () => {
    render(<DisasmPanel {...baseDisasmProps} />);
    expect(document.querySelector('.disasm-pc-arrow')).not.toBeNull();
  });

  it('calls onToggleBp when breakpoint gutter dot clicked', () => {
    const onToggleBp = vi.fn();
    render(<DisasmPanel {...baseDisasmProps} onToggleBp={onToggleBp} />);
    fireEvent.click(document.querySelectorAll('.disasm-bp')[0]);
    expect(onToggleBp).toHaveBeenCalled();
  });

  it('shows filled circle for an address with a breakpoint', () => {
    render(<DisasmPanel {...baseDisasmProps} breakpoints={new Map([[0x100, null]])} />);
    expect(document.querySelectorAll('.disasm-bp')[0].textContent).toBe('●');
  });

  it('shows breakpoint list footer when breakpoints exist', () => {
    render(<DisasmPanel {...baseDisasmProps} breakpoints={new Map([[0x100, null], [0x102, null]])} />);
    expect(screen.getByText(/BREAKPOINTS \(2\)/)).toBeInTheDocument();
  });

  it('calls onClearAllBps when ✕ All clicked', () => {
    const onClearAllBps = vi.fn();
    render(<DisasmPanel {...baseDisasmProps} breakpoints={new Map([[0x100, null]])} onClearAllBps={onClearAllBps} />);
    fireEvent.click(screen.getByTitle('Clear all breakpoints'));
    expect(onClearAllBps).toHaveBeenCalledOnce();
  });
});

// ── RegPanel ──────────────────────────────────────────────────────────────────
import { RegPanel } from './RegPanel.jsx';

const baseRegsReg = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x100, sp: 0xFFFF };

describe('RegPanel', () => {
  it('renders all register names', () => {
    withCtx(<RegPanel regs={baseRegsReg} prev={{}} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    ['A', 'B', 'C', 'D', 'E', 'H', 'L', 'PC', 'SP'].forEach(name => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
  });

  it('displays register values in hex', () => {
    withCtx(<RegPanel regs={{ ...baseRegsReg, a: 0xAB }} prev={{}} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(screen.getByText('AB')).toBeInTheDocument();
  });

  it('shows base toggle button with current base label', () => {
    withCtx(<RegPanel regs={baseRegsReg} prev={{}} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(screen.getByText('HEX')).toBeInTheDocument();
  });

  it('calls onRegBase with next base when base button clicked', () => {
    const onRegBase = vi.fn();
    withCtx(<RegPanel regs={baseRegsReg} prev={{}} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />, { onRegBase });
    fireEvent.click(screen.getByText('HEX'));
    expect(onRegBase).toHaveBeenCalledWith('dec');
  });

  it('renders 8 bit-viewer cells for register A', () => {
    withCtx(<RegPanel regs={baseRegsReg} prev={{}} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(document.querySelectorAll('.reg-bit').length).toBe(8);
  });

  it('marks changed registers with changed class', () => {
    withCtx(<RegPanel regs={{ ...baseRegsReg, a: 0x05 }} prev={{ ...baseRegsReg, a: 0x00 }} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(document.querySelectorAll('.reg-row.changed, .reg-pair-cell.changed').length).toBeGreaterThan(0);
  });

  it('collapses and expands on header click', () => {
    withCtx(<RegPanel regs={baseRegsReg} prev={{}} onJump={vi.fn()} dragHandleProps={{}} dropTargetProps={{}} isDragOver={false} />);
    expect(document.querySelectorAll('.reg-bit').length).toBe(8);
    fireEvent.click(document.querySelector('.panel-hd.collapsible'));
    expect(document.querySelectorAll('.reg-bit').length).toBe(0);
  });
});
