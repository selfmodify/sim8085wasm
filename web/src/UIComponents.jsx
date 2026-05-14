import React from 'react';

/**
 * Core panel layout reflecting the dense, technical vibe of the simulator.
 * Expects design tokens (--bg1, --bg2, --border, --mono) to be present.
 */
export function Panel({ title, icon, children, className = '', isCollapsible = false, onToggle, collapsed = false }) {
  return (
    <div className={`panel ${className}`}>
      <div 
        className={`panel-hd ${isCollapsible ? 'collapsible' : ''}`} 
        onClick={isCollapsible ? onToggle : undefined}
      >
        <span className="panel-title">
          {icon && <span className="panel-icon">{icon}</span>}
          {title}
        </span>
      </div>
      {!collapsed && (
        <div className="panel-body">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Main button primitive.
 * Variant toggles adjust --border/--bg relationships matching DESIGN_SYSTEM.md.
 */
export function Button({ children, onClick, variant = 'default', title, disabled = false, className = '' }) {
  return (
    <button className={`btn btn-${variant} ${className}`} onClick={onClick} title={title} disabled={disabled}>
      {children}
    </button>
  );
}