import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimWorkerProxy } from './workerProxy.js';

describe('SimWorkerProxy', () => {
  let proxy;
  let mockWorker;

  beforeEach(() => {
    // 1. Create a mock for the internal Web Worker
    mockWorker = {
      postMessage: vi.fn(),
      onmessage: null, // The proxy will assign its listener here
    };

    // 2. Intercept the global Worker constructor
    vi.stubGlobal('Worker', vi.fn(() => mockWorker));

    // 3. Initialize the proxy
    proxy = new SimWorkerProxy();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should initialize and share SharedArrayBuffers with the worker', () => {
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: 'INIT_SHARED_MEM',
      payload: proxy.sharedMemBuffer,
    });
    
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: 'INIT_SHARED_REGS',
      payload: proxy.sharedRegBuffer,
    });
    
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: 'INIT_SHARED_IO',
      payload: proxy.sharedIoBuffer,
    });
  });

  it('should handle async assemble() requests and resolve promises', async () => {
    // Arrange: Tell our mock worker to instantly reply to the ASSEMBLE command
    mockWorker.postMessage.mockImplementation((msg) => {
      if (msg.type === 'ASSEMBLE') {
        mockWorker.onmessage({
          data: { 
            id: msg.id, 
            type: 'RESULT', 
            payload: { ok: true, bytesEmitted: 5 } 
          }
        });
      }
    });

    // Act: Call the async method
    const result = await proxy.assemble('MVI A, 42H');

    // Assert: The promise should resolve with the exact payload
    expect(result.ok).toBe(true);
    expect(result.bytesEmitted).toBe(5);
  });

  it('should reject promises if the worker returns an ERROR', async () => {
    mockWorker.postMessage.mockImplementation((msg) => {
      if (msg.type === 'ASSEMBLE') {
        mockWorker.onmessage({
          data: { id: msg.id, type: 'ERROR', payload: 'Syntax error' }
        });
      }
    });

    await expect(proxy.assemble('INVALID')).rejects.toBe('Syntax error');
  });

  it('should perform synchronous memory reads and writes via SharedArrayBuffer', () => {
    // Act
    proxy.simWriteByte(0x1000, 0x55);

    // Assert: Memory should instantly reflect the change
    expect(proxy.simReadByte(0x1000)).toBe(0x55);

    // Assert: A WRITE_BYTE message must be sent to keep WASM in sync
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: 'WRITE_BYTE',
      payload: { addr: 0x1000, val: 0x55 }
    });
  });

  it('should trigger onStateUpdate callbacks and update MHz', () => {
    const onStateUpdateSpy = vi.fn();
    proxy.onStateUpdate = onStateUpdateSpy;

    // Simulate the worker pushing a state update
    mockWorker.onmessage({ data: { type: 'STATE_UPDATE', payload: { mhz: 2.5 } } });

    expect(onStateUpdateSpy).toHaveBeenCalled();
    expect(proxy.simGetMHz()).toBe(2.5);
  });

  it('should send interrupt assertions to the worker', () => {
    // Let's assume TRAP is enum 4
    proxy.simAssertInterrupt(4);
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: 'ASSERT_INTERRUPT',
      payload: { intType: 4 }
    });
  });

  it('should expose synchronous interrupt state', () => {
    // Manually mutate the shared buffer to test the getter
    proxy.sharedRegs[14] = 1; // IFF
    proxy.sharedRegs[17] = 1; // TRAP Pending
    
    const intState = proxy.simGetIntState();
    expect(intState.iff).toBe(true);
    expect(intState.trap).toBe(true);
  });

  it('should handle synchronous I/O port reads and writes', () => {
    proxy.simSetInPort(0x42, 0xAA);
    
    expect(proxy.sharedInPorts[0x42]).toBe(0xAA);
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: 'SET_INPUT_PORT',
      payload: { port: 0x42, val: 0xAA }
    });

    proxy.sharedOutPorts[0x10] = 0x55; // Simulate worker writing to out port
    expect(proxy.simGetOutPort(0x10)).toBe(0x55);
  });
});