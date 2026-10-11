#!/usr/bin/env node
// Market Signal Bot — simulated RSI / momentum signals on a synthetic order book.
// PAPER ONLY. No network, no exchange, no keys. Inspired in spirit by Hummingbot
// (https://github.com/hummingbot/hummingbot) — none of its code is used.
//
// Emits NDJSON on stdout: {ts, bot, type: "bot.log|bot.signal|bot.metric", data}
// Stdlib only (node >=18). Honors SIGINT/SIGTERM.

const BOT = 'market-signal';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const symbol = args.symbol ?? 'ETH-USD';
const interval = Number(args.interval ?? 3) * 1000;
const period = Number(args.period ?? 14);

let running = true;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  if (!running) return;
  running = false;
  clearInterval(timer);
  emit('bot.log', { level: 'info', msg: 'signal bot stopped' });
});

const emit = (type, data) =>
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), bot: BOT, type, data }) + '\n');

let price = 3000;
const changes = [];

function rsi() {
  if (changes.length < period) return null;
  const window = changes.slice(-period);
  const gains = window.filter((c) => c > 0).reduce((a, b) => a + b, 0) / period;
  const losses = -window.filter((c) => c < 0).reduce((a, b) => a + b, 0) / period;
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

emit('bot.log', { level: 'info', msg: `signal bot online for ${symbol} (paper mode)`, indicator: `RSI(${period})` });

const timer = setInterval(() => {
  if (!running) return;
  const prev = price;
  price = Math.max(1, price * (1 + (Math.random() - 0.5) * 0.02));
  changes.push(price - prev);
  if (changes.length > period * 4) changes.shift();

  const r = rsi();
  const volatility = Math.abs(price - prev) / prev;
  if (r !== null) {
    if (r < 30) emit('bot.signal', { action: 'buy', symbol, price: +price.toFixed(2), rsi: +r.toFixed(1), reason: 'oversold' });
    else if (r > 70) emit('bot.signal', { action: 'sell', symbol, price: +price.toFixed(2), rsi: +r.toFixed(1), reason: 'overbought' });
  }
  emit('bot.metric', { symbol, price: +price.toFixed(2), rsi: r === null ? null : +r.toFixed(1), volatility: +volatility.toFixed(5), intensity: Math.min(1, volatility * 40) });
}, interval);
