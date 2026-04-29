import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'

// Convert Windows path to WSL mount path (e.g. F:\foo → /mnt/f/foo)
const winRoot = path.resolve(import.meta.dirname, '..')
const wslRoot = winRoot
  .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
  .replace(/\\/g, '/')

function runWasmBuild() {
  return new Promise((resolve, reject) => {
    const cmd = [
      'source ~/emsdk/emsdk_env.sh',
      `mkdir -p "${wslRoot}/build-wasm"`,
      `cd "${wslRoot}/build-wasm"`,
      '[ -f CMakeCache.txt ] || emcmake cmake ..',
      'cmake --build .',
    ].join(' && ')
    const proc = spawn('wsl', ['-e', 'bash', '-c', cmd], { stdio: 'inherit' })
    proc.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`WASM build failed (exit ${code})`))
    )
  })
}

function wasmBuildPlugin() {
  let building = false
  return {
    name: 'wasm-auto-build',
    async configureServer(server) {
      const out = path.resolve(import.meta.dirname, 'public/sim8085.js')
      if (!existsSync(out)) {
        console.log('\n[wasm] sim8085.js not found — building now...\n')
        try { await runWasmBuild() }
        catch (e) { console.error('[wasm] Build failed:', e.message) }
      }

      const coreDir = path.resolve(import.meta.dirname, '../core')
      server.watcher.add(coreDir)
      server.watcher.on('change', async file => {
        if (building || !/\.(c|h)$/.test(file)) return
        building = true
        console.log(`\n[wasm] ${path.basename(file)} changed — rebuilding...\n`)
        try {
          await runWasmBuild()
          server.ws.send({ type: 'full-reload' })
        } catch (e) {
          console.error('[wasm] Rebuild failed:', e.message)
        } finally {
          building = false
        }
      })
    },
  }
}

// Change base to '/your-repo-name/' for GitHub Pages, or '/' for Netlify/Vercel
export default defineConfig({
  plugins: [react(), wasmBuildPlugin()],
  base: '/sim8085wasm/',   // ← must match your repo name exactly
})
