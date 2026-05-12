import { ExampleMenu } from './ExampleMenu.jsx';
import { PanelsMenu } from './PanelsMenu.jsx';
import { SPEEDS } from './utils.js';

export function Toolbar({
  onLoadExample, panels, onTogglePanel, fileInputRef, onImportFile,
  isDirty, onBuild, running, appState, onStep, onStepOver, onStepOut,
  onStepBack, histLen, onRun, runSpeed, onSpeedChange, onReset
}) {
  return (
    <div className="toolbar">
      <ExampleMenu onLoad={onLoadExample} />
      <PanelsMenu panels={panels} onToggle={onTogglePanel} />
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".asm,.85,.s,.txt,.hex,.bin" onChange={onImportFile} />
      <button className={`btn btn-asm${isDirty ? ' btn-asm-dirty' : ''}`} onClick={onBuild} title={isDirty ? "Unsaved changes — click to rebuild" : "Code is up to date"}>
        ⚙ Build{isDirty ? ' •' : ''}  <kbd>F5</kbd>
      </button>
      <button className="btn btn-step" onClick={onStep} disabled={running || appState === 'error'}>↓ Step    <kbd>F7</kbd></button>
      <button className="btn btn-step-over" onClick={onStepOver} disabled={running || appState === 'error'}>↷ Over    <kbd>F8</kbd></button>
      <button className="btn btn-step-out" onClick={onStepOut} disabled={running || appState === 'error'}>↵ Out     <kbd>F10</kbd></button>
      <button className="btn btn-back" onClick={onStepBack} disabled={running || appState === 'error' || histLen === 0} title={`Undo last step (${histLen} available)`}>⟲ Back{histLen > 0 ? ` (${histLen})` : ''}</button>
      <button className={`btn ${running ? 'btn-stop' : 'btn-run'}`} onClick={onRun} disabled={!running && appState === 'error'}>
        {running ? '■ Stop' : '▶ Run'}  <kbd>F9</kbd>
      </button>
      <label className="speed-label" title={SPEEDS[runSpeed].warp ? 'Warp: run until HLT, updating UI once per second' : SPEEDS[runSpeed].delay ? `Auto: ${SPEEDS[runSpeed].steps} step every ${SPEEDS[runSpeed].delay}ms` : `${SPEEDS[runSpeed].steps.toLocaleString()} steps/tick`}>
        Speed
        <input type="range" min={0} max={SPEEDS.length - 1} value={runSpeed} className="speed-slider"
          onChange={onSpeedChange} />
        <span className="speed-val">{SPEEDS[runSpeed].label}</span>
      </label>
      <button className="btn btn-reset" onClick={onReset} disabled={running}>↺ Reset  <kbd>F6</kbd></button>
    </div>
  );
}