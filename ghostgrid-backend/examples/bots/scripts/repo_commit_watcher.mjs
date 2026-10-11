#!/usr/bin/env node
// Repo Commit Watcher — watches a public GitHub repo for new commits.
// Uses the public GitHub REST API (read-only GET). A token is optional; without one
// you get the lower unauthenticated rate limit. Pass GITHUB_TOKEN in env to raise it.
// Inspired in spirit by joobert/Mitten (https://github.com/joobert/Mitten) — none of
// its code is used. Stdlib only (node >=22, global fetch).
//
// Emits NDJSON on stdout: {ts, bot, type: "bot.log|bot.item|bot.metric", data}
// Honors SIGINT/SIGTERM.

const BOT = 'repo-commit-watcher';
const argv = process.argv.slice(2);
const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : def; };
const repo = get('--repo', 'freqtrade/freqtrade');
const branch = get('--branch', '');
const interval = Number(get('--interval', 120)) * 1000;
const historyLimit = Number(get('--history-limit', 10_000));
if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) throw new Error('--history-limit must be a positive integer');

let running = true;
const shutdown = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { running = false; shutdown.abort(); });
const emit = (type, data) =>
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), bot: BOT, type, data }) + '\n');

const headers = { 'User-Agent': 'Ghost Grid-Commit-Bot/1.0', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const seen = new Set();
let polls = 0;

async function poll() {
  const url = `https://api.github.com/repos/${repo}/commits${branch ? `?sha=${encodeURIComponent(branch)}` : ''}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(15_000)]) });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); emit('bot.log', { level: 'warn', msg: `github ${res.status}`, remaining: res.headers.get('x-ratelimit-remaining') }); return; }
    const commits = await res.json();
    let fresh = 0;
    for (const c of commits.slice().reverse()) {
      if (seen.has(c.sha)) continue;
      seen.add(c.sha);
      if (seen.size > historyLimit) seen.delete(seen.values().next().value);
      fresh++;
      if (polls > 0) emit('bot.item', { sha: c.sha.slice(0, 7), msg: (c.commit?.message ?? '').split('\n')[0].slice(0, 200), author: c.commit?.author?.name, url: c.html_url });
    }
    emit('bot.metric', { repo, latest: commits[0]?.sha?.slice(0, 7) ?? null, newCommits: polls === 0 ? 0 : fresh, tracked: seen.size });
  } catch (e) {
    if (!running) return;
    emit('bot.log', { level: 'warn', msg: `poll failed: ${e.message}` });
  }
}

emit('bot.log', { level: 'info', msg: 'commit watcher online', repo });
async function loop() {
  while (running) {
    await poll();
    polls++;
    let slept = 0;
    while (running && slept < interval) { await new Promise((r) => setTimeout(r, Math.min(500, interval - slept))); slept += 500; }
  }
  emit('bot.log', { level: 'info', msg: 'commit watcher stopped', polls });
  process.exit(0);
}
loop();
