export class SimWorkerProxy {
  constructor() {
    this.worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
    this.msgId = 0;
    this.callbacks = new Map();
    this.onStateUpdate = null; // Callback for React to subscribe to
    this.lastMhz = 0;

    // Track watchpoints synchronously so the React UI can query them instantly
    this.jsDBP = new Set();
    this.jsDataWatchHit = -1;

    // Create a 64KB SharedArrayBuffer for the 8085 RAM
    // Note: Requires Cross-Origin-Opener-Policy & Cross-Origin-Embedder-Policy headers!
    this.sharedMemBuffer = new SharedArrayBuffer(65536);
    this.sharedRam = new Uint8Array(this.sharedMemBuffer);

    // Create a 128-byte SharedArrayBuffer for 32x 32-bit registers/status fields
    this.sharedRegBuffer = new SharedArrayBuffer(128);
    this.sharedRegs = new Int32Array(this.sharedRegBuffer);

    // Create a 512-byte SharedArrayBuffer for I/O ports (0-255 IN, 256-511 OUT)
    this.sharedIoBuffer = new SharedArrayBuffer(512);
    this.sharedInPorts = new Uint8Array(this.sharedIoBuffer, 0, 256);
    this.sharedOutPorts = new Uint8Array(this.sharedIoBuffer, 256, 256);

    // Share the buffers with the worker
    this.worker.postMessage({ type: 'INIT_SHARED_MEM', payload: this.sharedMemBuffer });
    this.worker.postMessage({ type: 'INIT_SHARED_REGS', payload: this.sharedRegBuffer });
    this.worker.postMessage({ type: 'INIT_SHARED_IO', payload: this.sharedIoBuffer });

    this.worker.onmessage = (e) => {
      const { id, type, payload } = e.data;
      
      // Capture the watchHit when the simulator stops
      if (type === 'stopped' || e.data.type === 'stopped') {
        this.jsDataWatchHit = e.data.watchHit ?? payload?.watchHit ?? -1;
      }

      if (type === 'STATE_UPDATE') {
        if (payload && payload.mhz !== undefined) {
          this.lastMhz = payload.mhz;
        }
        if (this.onStateUpdate) this.onStateUpdate();
      } else if (type === 'RESULT' && this.callbacks.has(id)) {
        this.callbacks.get(id).resolve(payload);
        this.callbacks.delete(id);
      } else if (type === 'ERROR' && this.callbacks.has(id)) {
        this.callbacks.get(id).reject(payload);
        this.callbacks.delete(id);
      }
    };
  }

  // Helper to send a message and wait for a response
  _request(type, payload) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  // --- Public API mirroring your old simProxy ---

  async assemble(code) {
    return this._request('ASSEMBLE', { code });
  }

  run() {
    this.worker.postMessage({ type: 'RUN' });
  }

  pause() {
    this.worker.postMessage({ type: 'PAUSE' });
  }
  
  step() {
    this.worker.postMessage({ type: 'STEP' });
  }

  stepOver() {
    this.worker.postMessage({ type: 'STEP_OVER' });
  }

  stepOut() {
    this.worker.postMessage({ type: 'STEP_OUT' });
  }

  // --- Synchronous Memory API ---
  // Because we use a SharedArrayBuffer, we can read/write memory 
  // synchronously from the React UI without waiting for the worker.

  simReadByte(addr) {
    return this.sharedRam[addr];
  }

  simWriteByte(addr, val) {
    this.sharedRam[addr] = val;
    // Notify the worker so it can update the WASM memory state
    this.worker.postMessage({ type: 'WRITE_BYTE', payload: { addr, val } });
  }

  simGetMemory(start, length) {
    return this.sharedRam.slice(start, start + length);
  }

  // --- Synchronous Register API ---
  simGetRegisters() {
    return {
      pc: this.sharedRegs[0],
      sp: this.sharedRegs[1],
      a:  this.sharedRegs[2],
      b:  this.sharedRegs[3],
      c:  this.sharedRegs[4],
      d:  this.sharedRegs[5],
      e:  this.sharedRegs[6],
      h:  this.sharedRegs[7],
      l:  this.sharedRegs[8],
      flags: this.sharedRegs[9]
    };
  }

  simIsHalted() {
    return !!this.sharedRegs[10];
  }

  simHasError() {
    return !!this.sharedRegs[11];
  }

  // --- Cycle Counter ---
  simGetCycles() {
    const lo = this.sharedRegs[12] >>> 0;
    const hi = this.sharedRegs[13] >>> 0;
    return hi * 0x100000000 + lo;
  }

  // --- Speedometer ---
  simGetMHz() {
    return this.lastMhz;
  }

  // --- Breakpoints ---
  simSetBreakpoint(addr) {
    this.worker.postMessage({ type: 'SET_BREAKPOINT', payload: { addr } });
  }

  simClearBreakpoint(addr) {
    this.worker.postMessage({ type: 'CLEAR_BREAKPOINT', payload: { addr } });
  }

  simClearAllBreakpoints() {
    this.worker.postMessage({ type: 'CLEAR_ALL_BREAKPOINTS' });
  }

  // --- Data Breakpoints (Watchpoints) ---
  simSetDataBreakpoint(addr) {
    if (this.jsDBP.has(addr)) {
      this.jsDBP.delete(addr);
      this.worker.postMessage({ cmd: 'clearDataBreakpoint', addr });
      return 2; // Indicate it was toggled OFF
    }
    this.jsDBP.add(addr);
    this.worker.postMessage({ cmd: 'setDataBreakpoint', addr });
    return 1; // Indicate it was toggled ON
  }

  simClearDataBreakpoint(addr) {
    this.jsDBP.delete(addr);
    this.worker.postMessage({ cmd: 'clearDataBreakpoint', addr });
  }

  simClearAllDataBreakpoints() {
    this.jsDBP.clear();
    this.jsDataWatchHit = -1;
    this.worker.postMessage({ cmd: 'clearAllDataBreakpoints' });
  }

  simIsDataBreakpoint(addr) { 
    return this.jsDBP.has(addr); 
  }
  simGetDataBreakpoints() { 
    return [...this.jsDBP]; 
  }
  simGetDataWatchHit() { 
    return this.jsDataWatchHit; 
  }

  // --- Interrupts ---
  simAssertInterrupt(intType) {
    this.worker.postMessage({ type: 'ASSERT_INTERRUPT', payload: { intType } });
  }

  simDeassertInterrupt(intType) {
    this.worker.postMessage({ type: 'DEASSERT_INTERRUPT', payload: { intType } });
  }

  simGetIntState() {
    return {
      iff: !!this.sharedRegs[14],
      mask: this.sharedRegs[15],
      rst75: !!this.sharedRegs[16],
      trap: !!this.sharedRegs[17],
      rst65: !!this.sharedRegs[18],
      rst55: !!this.sharedRegs[19]
    };
  }

  // --- I/O Ports ---
  simGetOutPort(port) {
    return this.sharedOutPorts[port];
  }

  simGetInPort(port) {
    return this.sharedInPorts[port];
  }

  simSetInPort(port, val) {
    this.sharedInPorts[port] = val;
    // Notify the worker to update the internal C-core IN port state
    this.worker.postMessage({ type: 'SET_INPUT_PORT', payload: { port, val } });
  }

  // --- Snapshots ---
  simGetSnapshot() {
    return {
      ram: new Uint8Array(this.sharedRam), // Create a true copy of current RAM
      regs: this.simGetRegisters()         // simGetRegisters returns a new object
    };
  }

  simRestoreSnapshot(snap) {
    this.worker.postMessage({ type: 'RESTORE_SNAPSHOT', payload: snap });
  }
}