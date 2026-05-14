import React from 'react';
import { INST_HELP } from './instHelp.js';

/**
 * Displays instruction details in a floating, highly dense tooltip.
 * Utilizes `--shadow-pop` and the technical typeface properties defined in DESIGN_SYSTEM.md.
 */
export function InstHelpPopup({ mnemonic, x, y, onClose }) {
  const info = INST_HELP[mnemonic.toUpperCase()];
  if (!info) return null;

  return (
    <div 
      className="help-popup" 
      style={{ top: y, left: x }} 
      onClick={onClose}
    >
      <div className="help-popup-hd">
        <span className="help-mnem">{mnemonic}</span>
        <span className="help-brief">{info.brief}</span>
      </div>
      <div className="help-popup-body">
        <div className="help-stats">
          <span>FLAGS: {info.flags}</span> · <span>BYTES: {info.bytes}</span> · <span>CYCLES: {info.cycles}</span>
        </div>
        <p className="help-desc">{info.desc}</p>
        <pre className="help-ex">{info.ex}</pre>
      </div>
    </div>
  );
}