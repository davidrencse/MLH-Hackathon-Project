import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { createGateway } from './proxy.mjs'
import ssh2 from 'ssh2'
import { OracleAgent } from './ssh-agent.mjs'

async function fixture(t, handle) {
  const upstream = http.createServer(handle)
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const agent = new http.Agent({ keepAlive: true })
  const gateway = createGateway({ agent, port: upstream.address().port })
  const sockets = new Set()
  for (const server of [gateway, upstream]) server.on('connection', socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
  })
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
  t.after(() => { agent.destroy(); for (const socket of sockets) socket.destroy(); gateway.close(); upstream.close() })
  return { upstream, port: gateway.address().port, url: `http://127.0.0.1:${gateway.address().port}` }
}

test('preserves authentication, path, query, status and POST body', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.headers.authorization !== 'Basic fixture') { res.writeHead(401); res.end(); return }
    let body = ''; req.on('data', b => { body += b }); req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ url: req.url, method: req.method, body }))
    })
  })
  assert.equal((await fetch(f.url + '/gg/health')).status, 401)
  const reply = await fetch(f.url + '/gg/api/task?x=1', { method: 'POST', headers: { Authorization: 'Basic fixture' }, body: 'work' })
  assert.equal(reply.status, 201)
  assert.deepEqual(await reply.json(), { url: '/gg/api/task?x=1', method: 'POST', body: 'work' })
})

test('forwards SSE immediately while the upstream response remains open', async t => {
  const f = await fixture(t, (req, res) => {
    assert.equal(req.headers['accept-encoding'], 'identity')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('event: ready\ndata: first\n\n')
    const timer = setTimeout(() => res.write('event: update\ndata: second\n\n'), 50)
    t.after(() => clearTimeout(timer))
  })
  const abort = new AbortController()
  t.after(() => abort.abort())
  const reply = await fetch(f.url + '/gg/events/stream', {
    headers: { Accept: 'text/event-stream', 'Accept-Encoding': 'gzip' },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
  })
  assert.equal(reply.headers.get('content-type'), 'text/event-stream')
  const reader = reply.body.getReader()
  let text = ''
  while (!text.includes('data: second')) text += new TextDecoder().decode((await reader.read()).value)
  assert.match(text, /data: first/)
  await reader.cancel()
})

test('keeps WebSocket upgrade bytes and bidirectional traffic intact', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(404); res.end() })
  f.upstream.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhello')
    socket.on('data', b => socket.write(b))
  })
  const socket = net.connect(f.port, '127.0.0.1'); t.after(() => socket.destroy())
  await once(socket, 'connect')
  let data = ''; socket.on('data', b => { data += b })
  socket.write('GET /bot-api/test/ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
  while (!data.includes('hello')) await once(socket, 'data')
  assert.match(data, /^HTTP\/1.1 101/)
  socket.write('ping')
  while (!data.includes('ping')) await once(socket, 'data')
  assert.match(data, /helloping/)
  socket.destroy()
})

test('a parallel asset burst uses one SSH login and preserves all responses', async t => {
  const f = await fixture(t, (req, res) => res.end(req.url))
  const host = ssh2.utils.generateKeyPairSync('ed25519')
  const clients = new Set()
  let logins = 0
  const ssh = new ssh2.Server({ hostKeys: [host.private] }, client => {
    logins++
    clients.add(client)
    client.on('error', () => {}) // the client closes live channels during teardown
    client.on('close', () => clients.delete(client))
    client.on('authentication', ctx => ctx.accept())
    client.on('tcpip', (accept, _reject, info) => {
      assert.equal(info.destIP, '127.0.0.1')
      assert.equal(info.destPort, 8080)
      const stream = accept()
      const socket = net.connect(f.upstream.address().port, '127.0.0.1')
      socket.pipe(stream).pipe(socket)
      stream.on('close', () => socket.destroy())
      socket.on('error', () => stream.destroy())
    })
  })
  ssh.listen(0, '127.0.0.1'); await once(ssh, 'listening')
  const agent = new OracleAgent({ host: '127.0.0.1', port: ssh.address().port, username: 'fixture' })
  const gateway = createGateway({ agent })
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening')
  t.after(() => { agent.destroy(); gateway.closeAllConnections(); gateway.close(); for (const client of clients) client.end(); ssh.close() })
  const replies = await Promise.all(Array.from({ length: 16 }, async (_, i) => {
    const response = await fetch(`http://127.0.0.1:${gateway.address().port}/asset-${i}.js`)
    assert.equal(response.status, 200)
    return response.text()
  }))
  assert.deepEqual(replies, Array.from({ length: 16 }, (_, i) => `/asset-${i}.js`))
  assert.equal(logins, 1)
})
