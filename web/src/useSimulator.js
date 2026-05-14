import { useState, useCallback, useEffect } from 'react';
import * as sim from './simProxy.js';

export function useSimulator() {
  const [regs, setRegs] = useState({});
  const [isHalted, setIsHalted] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [hasError, setHasError] = useState(false);

  const updateState = useCallback(() => {
    const currentRegs = sim.simGetRegisters();
    setRegs(currentRegs);
    setIsHalted(sim.simIsHalted());
    setIsRunning(sim.simIsRunning());
    setHasError(currentRegs.hasError);
  }, []);

  const build = useCallback((source) => {
    const result = sim.simAssemble(source);
    if (result.ok) updateState();
    return result;
  }, [updateState]);

  const step = useCallback(() => {
    sim.simStep();
    updateState();
  }, [updateState]);

  const run = useCallback((maxSteps = 100000) => {
    sim.simRun(maxSteps);
    updateState();
  }, [updateState]);

  const reset = useCallback(() => {
    sim.simReset(); // Ensure execution state is cleared
    updateState();
  }, [updateState]);

  return { regs, isHalted, isRunning, hasError, build, step, run, reset, updateState };
}