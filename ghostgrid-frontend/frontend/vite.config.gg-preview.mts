// TEMPORARY preview config used only to screenshot the city while vite.config.ts is mid-edit
// (it imports ./vite/creditsRelay, which does not exist yet). Mirrors vite.config.ts minus that
// plugin. Safe to delete.
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backendTarget = process.env.GG_BACKEND_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    proxy: {
      '/gg': {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (requestPath: string) => requestPath.replace(/^\/gg/, ''),
      },
    },
  },
})
