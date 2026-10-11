#!/usr/bin/env node
// Network Healthcheck Bot — pings URLs, records latency + up/down.
// Uses the network (that is the point). Only issues GET/HEAD to the URLs you pass in
// --targets; no credentials, no writes. Inspired in spirit by Uptime Kuma
// (https://github.com/louislam/uptime-kuma) — none of its code is used.
//
// Emits NDJSON on stdout: {ts, bot, type: "bot.log|bot.metric|bot.alert", data}
// Stdlib only (node >=22, global fetch). Honors SIGINT/SIGTERM.

const BOT = 'http-healthcheck';
const argv = process.argv.slice(2);
const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : def; };
const targets = (get('--targets', 'https://example.com')).split(',').map((s) => s.trim()).filter(Boolean);
const interval = Number(get('--interval', 30)) * 1000;
const timeoutMs = Number(get('--timeout', 10)) * 1000;

let running = true;
const shutdown = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { running = false; shutdown.abort(); });
const emit = (type, data) =>
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), bot: BOT, type, data }) + '\n');

async function check(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.any([ctrl.signal, shutdown.signal]) });
    const latency = Math.round(performance.now() - started);
    const up = res.ok;
    await res.body?.cancel().catch(() => {});
    emit('bot.metric', { url, up, status: res.status, latencyMs: latency });
    if (!up) emit('bot.alert', { severity: 'high', url, status: res.status, msg: 'target returned non-2xx' });
  } catch (e) {
    if (!running) return;
    emit('bot.metric', { url, up: false, status: null, latencyMs: null });
    emit('bot.alert', { severity: 'high', url, msg: `unreachable: ${e.name === 'AbortError' ? 'timeout' : e.message}` });
  } finally {
    clearTimeout(t);
  }
}

emit('bot.log', { level: 'info', msg: 'healthcheck online', targets });
async function loop() {
  while (running) {
    await Promise.all(targets.map(check));
    let slept = 0;
    while (running && slept < interval) { await new Promise((r) => setTimeout(r, Math.min(250, interval - slept))); slept += 250; }
  }
  emit('bot.log', { level: 'info', msg: 'healthcheck stopped' });
  process.exit(0);
}
loop();
