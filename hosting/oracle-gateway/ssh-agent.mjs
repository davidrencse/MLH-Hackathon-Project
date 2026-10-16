import http from 'node:http'
import ssh2 from 'ssh2'

// Multiplex HTTP sockets through one authenticated SSH connection. Opening an
// SSH login for every JS chunk can exhaust the host's unauthenticated-login cap.
export class OracleAgent extends http.Agent {
  constructor(config) {
    super({ keepAlive: true, maxSockets: 32, maxFreeSockets: 4 })
    this.config = config
    this.client = null
    this.connecting = null
    this.ready = false
    this.stopped = false
  }
  connection() {
    if (this.stopped) return Promise.reject(new Error('Gateway stopped'))
    if (this.ready) return Promise.resolve(this.client)
    if (this.connecting) return this.connecting
    const client = this.client = new ssh2.Client()
    this.connecting = new Promise((resolve, reject) => {
      client.once('ready', () => {
        this.ready = true
        this.connecting = null
        resolve(client)
      })
      client.on('error', reject)
      client.once('close', () => {
        this.ready = false
        this.connecting = null
        reject(new Error('Oracle SSH connection closed'))
      })
      client.connect(this.config)
    })
    return this.connecting
  }
  createConnection(_options, callback) {
    this.connection().then(client => {
      client.forwardOut('127.0.0.1', 0, '127.0.0.1', 8080, (error, stream) => {
        if (error) return callback(error)
        // Node's HTTP agent expects these TCP controls; SSH owns the real socket.
        for (const name of ['setKeepAlive', 'setNoDelay', 'setTimeout', 'ref', 'unref']) stream[name] = () => stream
        stream.destroySoon = stream.destroy
        callback(null, stream)
      })
    }).catch(callback)
  }
  destroy() {
    this.stopped = true
    super.destroy()
    this.client?.destroy()
  }
}
