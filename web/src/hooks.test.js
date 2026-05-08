/**
 * hooks.test.js
 * Tests for custom React hooks: useCollapsible and useCopy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCollapsible, useCopy } from './hooks.js';

// ── useCollapsible ────────────────────────────────────────────────────────────
describe('useCollapsible', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts with defaultCollapsed=false when no stored value', () => {
    const { result } = renderHook(() => useCollapsible('test_panel'));
    expect(result.current[0]).toBe(false);
  });

  it('starts with defaultCollapsed=true when passed', () => {
    const { result } = renderHook(() => useCollapsible('test_panel2', true));
    expect(result.current[0]).toBe(true);
  });

  it('toggle flips from false to true', () => {
    const { result } = renderHook(() => useCollapsible('test_panel3'));
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(true);
  });

  it('toggle flips back to false on second call', () => {
    const { result } = renderHook(() => useCollapsible('test_panel4'));
    act(() => { result.current[1](); });
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(false);
  });

  it('persists collapsed=true to localStorage', () => {
    const { result } = renderHook(() => useCollapsible('persist_key'));
    act(() => { result.current[1](); }); // → true
    expect(localStorage.getItem('panel_collapsed_persist_key')).toBe('true');
  });

  it('persists collapsed=false to localStorage', () => {
    const { result } = renderHook(() => useCollapsible('persist_key2', true));
    act(() => { result.current[1](); }); // true → false
    expect(localStorage.getItem('panel_collapsed_persist_key2')).toBe('false');
  });

  it('reads initial state from localStorage when value is stored', () => {
    localStorage.setItem('panel_collapsed_preloaded', 'true');
    const { result } = renderHook(() => useCollapsible('preloaded', false));
    expect(result.current[0]).toBe(true); // localStorage wins over default
  });

  it('reads stored false from localStorage', () => {
    localStorage.setItem('panel_collapsed_preloaded2', 'false');
    const { result } = renderHook(() => useCollapsible('preloaded2', true));
    expect(result.current[0]).toBe(false);
  });

  it('falls back to defaultCollapsed when localStorage throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = renderHook(() => useCollapsible('err_key', true));
    expect(result.current[0]).toBe(true);
  });

  it('does not throw when localStorage.setItem throws on toggle', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = renderHook(() => useCollapsible('err_set'));
    expect(() => act(() => { result.current[1](); })).not.toThrow();
    expect(result.current[0]).toBe(true); // state still updates
  });
});

// ── useCopy ───────────────────────────────────────────────────────────────────
describe('useCopy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts with copied=null', () => {
    const { result } = renderHook(() => useCopy());
    expect(result.current[0]).toBeNull();
  });

  it('sets copied to the copied text immediately', () => {
    const { result } = renderHook(() => useCopy());
    act(() => { result.current[1]('hello'); });
    expect(result.current[0]).toBe('hello');
  });

  it('resets copied to null after 1200ms', () => {
    const { result } = renderHook(() => useCopy());
    act(() => { result.current[1]('world'); });
    expect(result.current[0]).toBe('world');
    act(() => { vi.advanceTimersByTime(1200); });
    expect(result.current[0]).toBeNull();
  });

  it('does not reset before 1200ms', () => {
    const { result } = renderHook(() => useCopy());
    act(() => { result.current[1]('stay'); });
    act(() => { vi.advanceTimersByTime(1199); });
    expect(result.current[0]).toBe('stay');
  });

  it('calls navigator.clipboard.writeText with the text', async () => {
    const { result } = renderHook(() => useCopy());
    act(() => { result.current[1]('clip me'); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('clip me');
  });

  it('copying again resets the 1200ms timer', () => {
    const { result } = renderHook(() => useCopy());
    act(() => { result.current[1]('first'); });
    act(() => { vi.advanceTimersByTime(600); });
    act(() => { result.current[1]('second'); });
    act(() => { vi.advanceTimersByTime(700); }); // only 700ms since second copy
    expect(result.current[0]).toBe('second');   // not yet reset
    act(() => { vi.advanceTimersByTime(600); }); // total 1300ms since second
    expect(result.current[0]).toBeNull();
  });
});
