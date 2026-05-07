# sim8085 — Web Frontend

This directory contains the React + Vite single-page application that serves as the user interface for the sim8085 simulator.

## Key Files

- **`src/App.jsx`**: The root React component containing all UI panels, state management, and logic for interacting with the simulator engine.
- **`src/simProxy.js`**: A module that abstracts the simulator engine, allowing the UI to seamlessly switch between the pure JavaScript fallback (`sim8085Bridge.js`) and the compiled WebAssembly core.
- **`src/sim8085Bridge.js`**: A complete, pure JavaScript implementation of the 8085 CPU, assembler, and system calls. It serves as a fallback when WebAssembly is unavailable or for comparison.
- **`public/sim8085.js`**: The Emscripten-generated WebAssembly module, built from the C code in the `core/` directory.

## Local Development

```bash
npm install
npm run dev
```
