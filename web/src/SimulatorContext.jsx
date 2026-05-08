import { createContext, useContext } from 'react'

export const SimulatorContext = createContext(null)
export const useSimulator = () => useContext(SimulatorContext)
