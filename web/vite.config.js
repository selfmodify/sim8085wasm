import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Change base to '/your-repo-name/' for GitHub Pages, or '/' for Netlify/Vercel
export default defineConfig({
  plugins: [react()],
  base: '/sim8085/',
})
