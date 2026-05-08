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
