import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { exec } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'

function runWasmBuild() {
  return new Promise((resolve, reject) => {
    // This more generic command works on any system (Windows, macOS, Linux)
    exec('npm run build:wasm', (err, stdout, stderr) => {
      if (err) {
        console.error(stderr)
        reject(new Error(`WASM build failed with exit code ${err.code}`))
        return
      }
      console.log(stdout)
      resolve()
    })
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
        if (/\.(jsx?|css)$/.test(file)) {
          console.log(`\n[vite] ⚡ Detected change in ${path.basename(file)} — Hot Updating browser...\n`)
          return
        }
        if (building || !/\.(c|h)$/.test(file)) return
        building = true
        console.log(`\n[wasm] ${path.basename(file)} changed — rebuilding...\n`)
        try {
          await runWasmBuild()
          console.log('\n[wasm] ✅ Build successful! Reloading browser...\n')
          server.ws.send({ type: 'full-reload' })
        } catch (e) {
          console.error('\n[wasm] ❌ Rebuild failed:', e.message, '\n')
        } finally {
          building = false
        }
      })
    },
  }
}

// Change base to '/your-repo-name/' for GitHub Pages, or '/' for Netlify/Vercel
const buildTime = Date.now()

export default defineConfig({
  plugins: [
    react(),
    wasmBuildPlugin(),
  ],
  base: '/sim8085/',   // ← must match your repo name exactly
  define: { __BUILD_TIME__: JSON.stringify(buildTime) },
  server: {
    watch: { usePolling: true }
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.js'],
    exclude: ['node_modules', 'dist', '**/*.puppeteer.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/App.jsx',
        'src/AsmEditor.jsx',
        'src/examples.js',
        'src/simProxy.js',
        'src/simWasmBridge.js',
        'src/simWorker.js',
        'src/instHelp.js',
        'src/lang.js',
        'src/main.jsx',
        'src/**/*Modal.jsx',
        'src/**/*View.jsx',
        'src/**/*Menu.jsx',
        'src/AudioPanel.jsx',
        'src/ChatPanel.jsx',
        'src/LedDisplay.jsx',
        'src/MemPanel.jsx',
        'src/PIT8253Panel.jsx',
        'src/PPI8255Panel.jsx',
        'src/PairPanel.jsx',
        'src/StackPanel.jsx',
        'src/UIDialog.jsx',
        'src/ErrorBoundary.jsx',
      ],
      thresholds: {
        statements: 70,
        functions: 50,
        branches: 55,
        lines: 70,
      },
    },
  },
})
