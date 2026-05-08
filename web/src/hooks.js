import { useState, useCallback } from 'react';

export function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = useCallback((text) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(text);
    setTimeout(() => setCopied(null), 1200);
  }, []);
  return [copied, copy];
}

export function useCollapsible(key, defaultCollapsed = false) {
  const sk = 'panel_collapsed_' + key;
  const [collapsed, setCollapsed] = useState(() => {
    try { const s = localStorage.getItem(sk); return s !== null ? s === 'true' : defaultCollapsed }
    catch { return defaultCollapsed }
  });
  const toggle = useCallback(() => setCollapsed(v => {
    const next = !v;
    try { localStorage.setItem(sk, next) } catch {}
    return next;
  }), [sk]);
  return [collapsed, toggle];
}