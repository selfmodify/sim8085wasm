import { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

export function PopoutWindow({ title, theme, containerStyle, containerClass, onClose, children }) {
  const [container, setContainer] = useState(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handleDockAll = () => {
      if (onCloseRef.current) onCloseRef.current();
    };
    window.addEventListener('sim-dock-all', handleDockAll);
    return () => window.removeEventListener('sim-dock-all', handleDockAll);
  }, []);

  const externalWindow = useMemo(() => {
    let features = 'width=900,height=600,left=100,top=100';
    const key = 'sim8085_popout_' + title.replace(/\W+/g, '');
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && saved.w && saved.h) {
        features = `width=${saved.w},height=${saved.h},left=${saved.x},top=${saved.y}`;
      }
    } catch {}
    const win = window.open('', '', features);
    if (!win) alert('Please allow pop-ups to open this in a new window.');
    return win;
  }, []);

  useEffect(() => {
    if (!externalWindow) {
      onCloseRef.current();
      return;
    }

    const key = 'sim8085_popout_' + title.replace(/\W+/g, '');
    const saveBounds = () => {
      if (externalWindow.closed) return;
      try {
        if (externalWindow.innerWidth > 0) {
          localStorage.setItem(key, JSON.stringify({
            w: externalWindow.innerWidth,
            h: externalWindow.innerHeight,
            x: externalWindow.screenX,
            y: externalWindow.screenY
          }));
        }
      } catch {}
    };

    const interval = setInterval(saveBounds, 1000);

    // Copy all CSS over to the new window
    const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
    styles.forEach(style => {
      externalWindow.document.head.appendChild(style.cloneNode(true));
    });

    // Set up the mount point wrapper with base theme styles
    const target = externalWindow.document.createElement('div');
    target.className = 'app';
    target.style.height = '100vh';
    target.style.display = 'flex';
    target.style.flexDirection = 'column';
    target.style.overflow = 'hidden';
    target.style.backgroundColor = 'var(--bg)';
    
    externalWindow.document.body.appendChild(target);
    externalWindow.document.body.style.margin = '0';
    externalWindow.document.body.style.padding = '0';
    
    setContainer(target);

    const handleUnload = () => {
      saveBounds();
      onCloseRef.current();
    };
    externalWindow.addEventListener('unload', handleUnload);

    return () => { 
      clearInterval(interval);
      saveBounds();
      externalWindow.removeEventListener('unload', handleUnload);
      externalWindow.close(); 
    };
  }, [externalWindow, title]);

  useEffect(() => {
    if (externalWindow) {
      externalWindow.document.title = title;
    }
  }, [title, externalWindow]);

  useEffect(() => {
    if (externalWindow) {
      externalWindow.document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme, externalWindow]);

  useEffect(() => {
    if (!container) return;
    container.style.filter = containerStyle?.filter || '';
  }, [container, containerStyle]);

  useEffect(() => {
    if (!container) return;
    container.className = ('app ' + (containerClass || '')).trim();
  }, [container, containerClass]);

  if (!container) return null;
  return createPortal(children, container);
}