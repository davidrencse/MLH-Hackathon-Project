import { createServer } from 'node:http'
import { createGateway } from './proxy.mjs'
import { OracleAgent } from './ssh-agent.mjs'

for (const name of ['ORACLE_SSH_HOST', 'ORACLE_SSH_USER', 'ORACLE_HOST_SHA256']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`)
}
const agent = process.env.ORACLE_SSH_KEY ? new OracleAgent({
  host: process.env.ORACLE_SSH_HOST,
  port: 22,
  username: process.env.ORACLE_SSH_USER,
  privateKey: process.env.ORACLE_SSH_KEY,
  hostHash: 'sha256',
  hostVerifier: (hash) => hash === process.env.ORACLE_HOST_SHA256,
  readyTimeout: 15_000,
  keepaliveInterval: 15_000,
  keepaliveCountMax: 3,
}) : null

// Blueprints create the service first; its restricted key is set through Render's
// API afterward. Serve a bounded setup response until that secret is configured.
const server = agent ? createGateway({ agent }) : createServer((req, res) => {
  res.writeHead(req.url === '/healthz' ? 200 : 503, { 'content-type': 'text/plain', 'retry-after': '10' })
  res.end(req.url === '/healthz' ? 'ok' : 'The site is being connected. Please retry shortly.')
})
server.listen(Number(process.env.PORT ?? 10000), '0.0.0.0', () => console.log('Ghost Grid gateway listening'))
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  agent?.destroy()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
})
