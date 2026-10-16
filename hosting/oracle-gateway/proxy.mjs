import http from 'node:http'

// The destination is fixed by the operator. Browser URLs can only select a path.
export function createGateway({ agent, port = 8080 }) {
  const options = (req) => ({
    hostname: '127.0.0.1', port, agent, method: req.method, path: req.url,
    headers: { ...req.headers, 'x-forwarded-proto': 'https' },
  })
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"status":"ok"}')
      return
    }
    const upstream = http.request(options(req), (reply) => {
      const streaming = reply.headers['content-type']?.startsWith('text/event-stream')
      const headers = { ...reply.headers }
      if (streaming) {
        headers['cache-control'] = 'no-cache, no-transform'
        headers['x-accel-buffering'] = 'no'
        delete headers['content-length']
      }
      res.writeHead(reply.statusCode, headers)
      if (streaming) {
        res.flushHeaders()
        // An SSE comment primes buffering proxies without inventing an application event.
        res.write(`:${' '.repeat(2048)}\n\n`)
      }
      reply.pipe(res)
      reply.on('error', () => res.destroy())
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain', 'retry-after': '5' })
      res.end('The application is reconnecting. Please retry shortly.')
    })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    const upstream = http.request(options(req))
    upstream.on('upgrade', (reply, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`)
      for (const [name, value] of Object.entries(reply.headers)) {
        for (const entry of Array.isArray(value) ? value : [value]) {
          if (entry !== undefined) socket.write(`${name}: ${entry}\r\n`)
        }
      }
      socket.write('\r\n')
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remote.write(head)
      socket.pipe(remote).pipe(socket)
      socket.on('error', () => remote.destroy())
      remote.on('error', () => socket.destroy())
      socket.on('close', () => remote.destroy())
      remote.on('close', () => socket.destroy())
    })
    // An unauthenticated WebSocket must receive the upstream 401, not a 101.
    upstream.on('response', (reply) => {
      socket.end(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      reply.resume()
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.end()
  })
  server.requestTimeout = 0
  return server
}
