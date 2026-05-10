import { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

export function PopoutWindow({ title, theme, onClose, children }) {
  const [container, setContainer] = useState(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const externalWindow = useMemo(() => {
    const win = window.open('', '', 'width=900,height=600,left=100,top=100');
    if (!win) alert('Please allow pop-ups to open the Breadboard in a new window.');
    return win;
  }, []);

  useEffect(() => {
    if (!externalWindow) {
      onCloseRef.current();
      return;
    }

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

    const handleUnload = () => onCloseRef.current();
    externalWindow.addEventListener('unload', handleUnload);

    return () => { 
      externalWindow.removeEventListener('unload', handleUnload);
      externalWindow.close(); 
    };
  }, [externalWindow]);

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

  if (!container) return null;
  return createPortal(children, container);
}