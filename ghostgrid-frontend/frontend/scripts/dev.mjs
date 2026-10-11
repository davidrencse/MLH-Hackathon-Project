// Starts the Vite dev server through the JS API (the `vite` CLI hangs in some sandboxed shells).
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PORT || 5173)
const server = await createServer({ root, server: { port, strictPort: true, host: '127.0.0.1' } })
await server.listen()
server.printUrls()
