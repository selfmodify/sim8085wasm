// sim8085 UI kit — wires the simulator workspace together with a canned trace
const { useState, useMemo } = React;

// LED Count example, sliced to fit the visible disassembly window
const DISASM = [
  { addr: 0x100, bytes: '31 00 02', text: 'LXI  SP,0200H', cy: 10 },
  { addr: 0x103, bytes: 'AF',       text: 'XRA  A',        cy: 4 },
  { addr: 0x104, bytes: '21 00 03', text: 'LXI  H,0300H',  cy: 10 },
  { addr: 0x107, bytes: '06 08',    text: 'MVI  B,08H',    cy: 7 },
  { label: 'CLR:', addr: 0x109 },
  { addr: 0x109, bytes: '77',       text: 'MOV  M,A',      cy: 7 },
  { addr: 0x10A, bytes: '23',       text: 'INX  H',        cy: 6 },
  { addr: 0x10B, bytes: '05',       text: 'DCR  B',        cy: 4 },
  { addr: 0x10C, bytes: 'C2 09 01', text: 'JNZ  0109H',    cy: 10, bp: true },
  { addr: 0x10F, bytes: '21 00 04', text: 'LXI  H,0400H',  cy: 10 },
  { label: 'INC:', addr: 0x114 },
  { addr: 0x114, bytes: '21 00 03', text: 'LXI  H,0300H',  cy: 10 },
  { addr: 0x117, bytes: '06 00',    text: 'MVI  B,00H',    cy: 7 },
  { addr: 0x119, bytes: '0E 02',    text: 'MVI  C,02H',    cy: 7 },
  { addr: 0x11B, bytes: '78',       text: 'MOV  A,B',      cy: 4 },
  { addr: 0x11C, bytes: 'FE 08',    text: 'CPI  08H',      cy: 7 },
  { addr: 0x11E, bytes: 'C2 14 01', text: 'JNZ  0114H',    cy: 10 },
  { addr: 0x121, bytes: '21 07 03', text: 'LXI  H,0307H',  cy: 10 },
  { addr: 0x124, bytes: '7E',       text: 'MOV  A,M',      cy: 7 },
  { addr: 0x125, bytes: '3C',       text: 'INR  A',        cy: 4 },
  { addr: 0x126, bytes: 'FE 0A',    text: 'CPI  0AH',      cy: 7 },
  { addr: 0x128, bytes: 'CA 2F 01', text: 'JZ   012FH',    cy: 10 },
  { addr: 0x12B, bytes: '77',       text: 'MOV  M,A',      cy: 7 },
];

// Trace of register/flag states through Run/Step. PC walks through DISASM.
const TRACE = [
  // 0: idle / not built
  { pc: 0x100, regs: { A:0, B:0, C:0, D:0, E:0, H:0, L:0, PC:0x100, SP:0x0000 }, flags:{S:0,Z:0,AC:0,P:0,CY:0}, leds:[0,0,0,0,0,0,0,0], change: [], state:'idle', msg:'Ready', steps:0, cycles:0 },
  // 1: built — PC at 100H
  { pc: 0x100, regs: { A:0, B:0, C:0, D:0, E:0, H:0, L:0, PC:0x100, SP:0x0000 }, flags:{S:0,Z:0,AC:0,P:0,CY:0}, leds:[0,0,0,0,0,0,0,0], change: [], state:'idle', msg:'Built', steps:0, cycles:0 },
  // 2: after step 1: LXI SP,0200H
  { pc: 0x103, regs: { A:0, B:0, C:0, D:0, E:0, H:0, L:0, PC:0x103, SP:0x0200 }, flags:{S:0,Z:0,AC:0,P:0,CY:0}, leds:[0,0,0,0,0,0,0,0], change: ['SP','PC'], state:'idle', msg:'Stepped', steps:1, cycles:10 },
  // 3: XRA A
  { pc: 0x104, regs: { A:0, B:0, C:0, D:0, E:0, H:0, L:0, PC:0x104, SP:0x0200 }, flags:{S:0,Z:1,AC:0,P:1,CY:0}, leds:[0,0,0,0,0,0,0,0], change: ['A','PC'], state:'idle', msg:'Stepped', steps:2, cycles:14 },
  // 4: running mid-program (just after MOV A,B at 011B)
  { pc: 0x11B, regs: { A:0x01, B:0x02, C:0x02, D:0, E:0, H:0x03, L:0x02, PC:0x11B, SP:0x0200 }, flags:{S:0,Z:0,AC:0,P:0,CY:1}, leds:[0x3F,0x3F,0x3F,0x5B,0x7F,0x7D,0x4F,0x6D], change: ['A','PC'], state:'running', msg:'▶ Running...', steps:1042, cycles:8736 },
  // 5: halted at HLT-like state
  { pc: 0x12B, regs: { A:0x42, B:0x07, C:0x02, D:0, E:0, H:0x03, L:0x07, PC:0x12B, SP:0x0200 }, flags:{S:0,Z:0,AC:1,P:0,CY:0}, leds:[0x3F,0x3F,0x3F,0x5B,0x7F,0x7D,0x4F,0x6D], change: [], state:'halted', msg:'⏸ Halted', steps:1043, cycles:8740 },
];

// Editor: tokens for the LED Count example
const EDITOR = [
  [['cm','; Count 00000000 → 99999999 on all LEDs']],
  [['cm','; One decimal digit (0-9) stored per byte']],
  [['cm','; Field 0 (leftmost) = ten-million']],
  [['cm','; Run at Fast or Turbo speed to watch']],
  [['',''],['meta','org'],['',     '     '],['num','100H']],
  [['',''],['pseudo','kickoff'],['', ' '],['num','100H']],
  [['',''],['key','lxi'],['',     '     '],['reg','sp'],['',', '],['num','200H']],
  [['','']],
  [['',''],['cm','; Initialise all 8 digit bytes']],
  [['',''],['key','xra'],['',     '     '],['reg','a']],
  [['',''],['key','lxi'],['',     '     '],['reg','h'],['',', '],['num','300H']],
  [['',''],['key','mvi'],['',     '     '],['reg','b'],['',', '],['num','08H']],
  [['lbl','clr:']],
  [['',''],['key','mov'],['',     '     '],['reg','m'],['',', '],['reg','a']],
  [['',''],['key','inx'],['',     '     '],['reg','h']],
  [['',''],['key','dcr'],['',     '     '],['reg','b']],
  [['',''],['key','jnz'],['',     '     '],['','clr']],
  [['','']],
  [['lbl','show:']],
  [['',''],['cm','; Write each digit to its field']],
];

// Memory bytes for the visible window 0x100..0x17F
function makeMem() {
  const bytes = new Array(128).fill(0);
  // approximate the LED Count program bytes (matches screenshots ~roughly)
  const code = [
    0x31,0x00,0x02,0xAF,0x21,0x00,0x03,0x06,0x08,0x77,0x23,0x05,0xC2,0x09,0x01,0x21,
    0x00,0x04,0x2C,0x78,0xFE,0x08,0xC2,0x14,0x01,0x21,0x07,0x03,0x7E,0x3C,0xFE,0x0A,
    0xCA,0x2F,0x01,0x77,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  ];
  for (let i = 0; i < code.length; i++) bytes[i] = code[i];
  return bytes;
}

function App() {
  const [step, setStep] = useState(4);   // start mid-run for a "live" feel
  const [speed, setSpeed] = useState(100);
  const [bytes] = useState(makeMem());

  const t = TRACE[step];
  const running = t.state === 'running';
  const changes = useMemo(() => new Set(t.change), [step]);

  const onBuild = () => setStep(1);
  const onStep  = () => setStep(s => Math.min(s + 1, TRACE.length - 1));
  const onRun   = () => setStep(running ? 5 : 4);
  const onReset = () => setStep(0);

  // Compute code/preset highlight ranges
  const codeRange = [0x100, 0x12F];
  const presetRange = [0x130, 0x137];

  return (
    <div className="app">
      <Topbar
        running={running}
        speed={speed} onSpeed={setSpeed}
        onBuild={onBuild} onStep={onStep} onRun={onRun} onReset={onReset}
      />
      <div className="workspace">
        {/* LEFT — editor + LED */}
        <div className="col col-editor">
          <Editor lines={EDITOR} />
          <Panel icon="" title="INSTRUCTION HELP" style={{height:120,flexShrink:0}}>
            <div style={{padding:12, color:'var(--text3)', fontFamily:'var(--mono)', fontSize:12, fontStyle:'italic'}}>
              Ctrl+click an instruction for details
            </div>
          </Panel>
          <LEDStrip values={t.leds} />
        </div>

        {/* CENTER — disassembly + memory */}
        <div className="col col-center">
          <Disasm rows={DISASM} pc={t.pc} />
          <MemGrid bytes={bytes} base={0x100} pc={t.pc} sp={t.regs.SP - 1} codeRange={codeRange} presetRange={presetRange} />
        </div>

        {/* RIGHT — registers, flags, interrupts */}
        <div className="col col-right">
          <Registers regs={t.regs} changes={changes} />
          <RegPairs regs={t.regs} />
          <Flags flags={t.flags} />
          <Interrupts />
        </div>
      </div>
      <StatusBar state={t.state} msg={t.msg} steps={t.steps} cycles={t.cycles} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
