// sim8085 UI kit — components
const { useState, useEffect } = React;

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

function Btn({ kind = '', children, kbd, disabled, onClick }) {
  const cls = `btn ${kind ? 'btn-' + kind : ''}`.trim();
  return (
    <button className={cls} disabled={disabled} onClick={onClick}>
      {children}
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

function Topbar({ status, onBuild, onStep, onRun, onReset, running, speed, onSpeed }) {
  return (
    <div className="topbar">
      <button className="brand-trigger">
        <span className="brand-chip">≡ 8085</span>
      </button>
      <button className="btn btn-back">Examples <span style={{opacity:.7,fontSize:11}}>▾</span></button>
      <div className="toolbar">
        <Btn kind="asm" kbd="F5" onClick={onBuild}>↓ Build</Btn>
        <Btn kind="step" kbd="F7" onClick={onStep} disabled={running}>↻ Step</Btn>
        <Btn kind="back" disabled>⌂ Back</Btn>
        {running
          ? <Btn kind="stop" onClick={onRun}>■ Stop</Btn>
          : <Btn kind="run" kbd="F9" onClick={onRun}>▶ Run</Btn>}
        <span className="speed-label">
          Speed
          <input className="speed-slider" type="range" min="0" max="100" value={speed} onChange={e=>onSpeed(+e.target.value)} />
          <span className="speed-val">{speed >= 100 ? 'Turbo' : speed + '%'}</span>
        </span>
        <Btn kind="reset" kbd="F6" onClick={onReset}>↻ Reset</Btn>
      </div>
    </div>
  );
}

function Panel({ icon, title, right, grow, children, style }) {
  return (
    <div className={`panel ${grow ? 'panel-grow' : ''}`} style={style}>
      <div className="panel-hd">
        <span>{icon && <span className="panel-icon">{icon}</span>}{title}</span>
        <div className="panel-hd-right">
          {right}
          <button className="help-btn">?</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Editor({ lines }) {
  // lines: [{ tokens: [['key','MOV'],['ws',' '],...] }]
  return (
    <Panel icon="✎" title="EDITOR" right={<span style={{fontWeight:400,letterSpacing:0,textTransform:'none',color:'var(--text3)'}}>; semicolons for comments</span>} grow>
      <div className="editor-body">
        {lines.map((ln, i) => (
          <div key={i} className="editor-line">
            <span className="editor-ln">{i + 1}</span>
            <span className="editor-text">
              {ln.map((t, j) => <span key={j} className={t[0] ? 'tok-' + t[0] : ''}>{t[1]}</span>)}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Reg({ name, value, changed, wide }) {
  const fmt = wide ? hex4 : hex2;
  return (
    <div className={`reg-row ${changed ? 'changed' : ''}`}>
      <span className="reg-name">{name}</span>
      <span className="reg-hex">{fmt(value)}</span>
      <span className="reg-dec">{value}</span>
    </div>
  );
}

function RegPairCell({ name, value, changed }) {
  return (
    <div className={`reg-pair-cell ${changed ? 'changed' : ''}`}>
      <span className="reg-name">{name}</span>
      <span className="reg-hex">{hex2(value)}</span>
      <span className="reg-dec">{value}</span>
    </div>
  );
}

function Registers({ regs, changes }) {
  return (
    <Panel icon="" title="REGISTERS" right={<button className="help-btn" style={{marginRight:4}}>HEX</button>}>
      <div style={{padding:'2px 0'}}>
        <Reg name="A"  value={regs.A}  changed={changes.has('A')} />
        <div className="reg-pair-row">
          <RegPairCell name="B" value={regs.B} changed={changes.has('B')} />
          <RegPairCell name="C" value={regs.C} changed={changes.has('C')} />
        </div>
        <div className="reg-pair-row">
          <RegPairCell name="D" value={regs.D} changed={changes.has('D')} />
          <RegPairCell name="E" value={regs.E} changed={changes.has('E')} />
        </div>
        <div className="reg-pair-row">
          <RegPairCell name="H" value={regs.H} changed={changes.has('H')} />
          <RegPairCell name="L" value={regs.L} changed={changes.has('L')} />
        </div>
        <Reg name="PC" value={regs.PC} changed={changes.has('PC')} wide />
        <Reg name="SP" value={regs.SP} changed={changes.has('SP')} wide />
      </div>
    </Panel>
  );
}

function RegPairs({ regs }) {
  const pair = (h, l) => (regs[h] << 8) | regs[l];
  return (
    <Panel title="REGISTER PAIRS" right={<button className="help-btn" style={{marginRight:4}}>HEX</button>}>
      <div className="pair-col-hdr"><span></span><span>ADDR</span><span>CONTENT</span></div>
      {[['BC','B','C'],['DE','D','E'],['HL','H','L']].map(([n,h,l])=>(
        <div className="pair-row" key={n}>
          <span className="pair-name">{n}</span>
          <span className="pair-addr">{hex4(pair(h,l))}</span>
          <span className="pair-content">{hex2(0)}</span>
        </div>
      ))}
    </Panel>
  );
}

function Flags({ flags }) {
  const order = [['S','S'],['Z','Z'],['AC','AC'],['P','P'],['CY','CY']];
  return (
    <Panel title="FLAGS">
      <div className="flag-panel">
        <div className="flags-row">
          {order.map(([k, lbl]) => (
            <div key={k} className={`flag ${flags[k] ? 'flag-on' : ''}`}>
              <span className="flag-lbl">{lbl}</span>
              <span className="flag-val">{flags[k] ? 1 : 0}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Interrupts() {
  const rows = [
    { lbl: 'TRAP',   vec: '0024H', state: 'on' },
    { lbl: 'RST 7.5', vec: '003CH', state: 'on' },
    { lbl: 'RST 6.5', vec: '0034H', state: 'off' },
    { lbl: 'RST 5.5', vec: '002CH', state: 'off' },
  ];
  return (
    <Panel title="INTERRUPTS">
      <div className="int-panel">
        <div className="int-iff">IFF <span style={{color:'var(--text3)',fontWeight:700}}>DISABLED</span></div>
        {rows.map(r => (
          <div className="int-row" key={r.lbl}>
            <button className={`btn int-btn ${r.state === 'on' ? 'int-btn-on' : ''}`}>
              {r.state === 'on' ? 'FIRE' : 'OFF'}
            </button>
            <span className="int-label">{r.lbl}</span>
            <span className="int-vec">{r.vec}</span>
          </div>
        ))}
        <div className="int-row" style={{marginTop:4}}>
          <button className="btn int-btn">OFF</button>
          <span className="int-label">INTR</span>
          <span className="int-vec">RST <span style={{color:'var(--text2)'}}>7 (0038H) ▾</span></span>
        </div>
      </div>
    </Panel>
  );
}

function Disasm({ rows, pc }) {
  return (
    <Panel title="DISASSEMBLY" grow right={
      <span style={{display:'flex',gap:4}}>
        <button className="help-btn">addr</button>
        <button className="help-btn" style={{borderColor:'var(--accent)',color:'var(--accent)'}}>PC↓</button>
      </span>
    }>
      <div className="disasm-list">
        {rows.map(r => (
          r.label ? (
            <div className="disasm-label" key={'l'+r.addr}>{r.label}</div>
          ) : (
            <div key={r.addr} className={`disasm-row ${r.addr === pc ? 'cur' : ''} ${r.bp ? 'bp' : ''}`}>
              <span className="disasm-bp">{r.bp ? '●' : '·'}</span>
              <span className="disasm-text">{hex4(r.addr)}  {r.bytes.padEnd(8)} {r.text}</span>
              {r.addr === pc && <span className="disasm-pc-arrow">◀</span>}
              <span className="disasm-cycles">{r.cy}T</span>
            </div>
          )
        ))}
      </div>
    </Panel>
  );
}

function MemGrid({ base = 0x100, bytes, pc, sp, codeRange, presetRange }) {
  const cols = 16;
  const rows = Math.ceil(bytes.length / cols);
  return (
    <Panel title="MEMORY" right={
      <div className="mem-ctrl">
        <button className="mem-btn">«</button>
        <button className="mem-btn">◀</button>
        <input className="mem-cur-addr" value={hex4(base)} readOnly />
        <button className="mem-btn">▶</button>
        <button className="mem-btn">»</button>
      </div>
    }>
      <div className="mem-scroll">
        <table className="mem-tbl">
          <thead>
            <tr>
              <th className="mem-th-addr"></th>
              {Array.from({length: cols}).map((_,i)=><th className="mem-th" key={i}>{i.toString(16).toUpperCase().padStart(2,'0')}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({length: rows}).map((_, r) => (
              <tr key={r}>
                <td className="mem-row-addr">{hex4(base + r*cols)}</td>
                {Array.from({length: cols}).map((_, c) => {
                  const addr = base + r*cols + c;
                  const v = bytes[r*cols+c] ?? 0;
                  const inCode = codeRange && addr >= codeRange[0] && addr <= codeRange[1];
                  const inPre  = presetRange && addr >= presetRange[0] && addr <= presetRange[1];
                  let cls = 'mem-cell ' + (v ? 'mem-nz ' : '');
                  if (addr === pc) cls += 'mem-pc ';
                  else if (addr === sp) cls += 'mem-sp ';
                  else if (inCode) cls += 'mem-code ';
                  else if (inPre)  cls += 'mem-preset ';
                  return <td className={cls.trim()} key={c}>{hex2(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mem-legend">
        <span><span className="legend-pc">■</span> PC</span>
        <span><span className="legend-sp">■</span> SP</span>
        <span><span className="legend-code">■</span> Code</span>
        <span><span className="legend-preset">■</span> Data</span>
        <span style={{marginLeft:'auto',fontSize:11,color:'var(--text3)'}}>double-click to edit · click + ↑↓ to scroll</span>
      </div>
    </Panel>
  );
}

function LEDStrip({ values }) {
  const labels = ['ST7','ST6','A5','A4','A3','A2','A1','A0'];
  return (
    <Panel icon="💡" title="LED DISPLAY">
      <div className="led-digits">
        {values.map((v, i) => (
          <div key={i} className={`led-digit ${i < 2 ? 'led-digit-st' : ''}`}>
            <SevenSeg value={v} />
            <div className="led-val">{hex2(v)}</div>
            <div className="led-lbl">{labels[i]}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StatusBar({ state, msg, steps, cycles }) {
  return (
    <div className={`statusbar status-${state}`}>
      <span className="status-time">12:39:08 PM</span>
      <span className="status-msg">{msg}</span>
      <span className="status-meta">{steps} steps · {cycles} cycles</span>
    </div>
  );
}

Object.assign(window, { Topbar, Panel, Editor, Registers, RegPairs, Flags, Interrupts, Disasm, MemGrid, LEDStrip, StatusBar, Btn, hex2, hex4 });
