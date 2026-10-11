import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { ggCreditsRelay } from './vite/creditsRelay.js'

// The Ghostgrid backend (ghostgrid-backend, default http://127.0.0.1:3001) is proxied
// under /gg so the browser talks to it same-origin. The backend rejects any request
// carrying an unknown Origin header, so the proxy strips Origin — then the backend
// needs no GHOSTGRID_ALLOWED_ORIGINS for local development.
// Override the target with GG_BACKEND_URL; see src/api/config.ts for client options.
const backendTarget = process.env.GG_BACKEND_URL ?? 'http://127.0.0.1:3001'

// https://vite.dev/config/
export default defineConfig({
  // ggCreditsRelay serves GET /gg-dev/credits in dev only — see vite/creditsRelay.ts.
  plugins: [react(), tailwindcss(), ggCreditsRelay()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    proxy: {
      '/gg': {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/gg/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
        },
      },
    },
  },
})
