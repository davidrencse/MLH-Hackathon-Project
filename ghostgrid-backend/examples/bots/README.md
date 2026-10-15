# Ghost Grid — Custom Bot Catalog (demo seed)

Six ready-to-run **custom bots** so the city has varied buildings to populate before the
real Bot Runner (`/api/v1/bots`, owned by Codex) is wired. Each is a different *kind* of
bot across different districts, so the frontend can render a believable, busy city.

These are **demo seeds, not vendored third-party code.** Every script here is written
fresh, stdlib-only, and **paper/simulation-first**. The `inspiredBy` link on each catalog
entry points at the real open-source project it mimics in spirit — nothing from those
repos is bundled or executed.

## The bots

| id | kind | runtime | district / building | network? | inspired by |
|----|------|---------|---------------------|----------|-------------|
| `paper-trader` | trading | python | Market · Quant Exchange | no (synthetic) | [Freqtrade](https://github.com/freqtrade/freqtrade) |
| `market-signal` | trading | node | Market · Signal Lab | no (synthetic) | [Hummingbot](https://github.com/hummingbot/hummingbot) |
| `log-watchtower` | security | python | Security · Packet Watchtower | no (local file) | [grobomo/github-agent](https://github.com/grobomo/github-agent) |
| `http-healthcheck` | monitoring | node | Network · Extraction Relay | **yes** | [Uptime Kuma](https://github.com/louislam/uptime-kuma) |
| `rss-watcher` | automation | python | Memory · Research Terminal | **yes** | [joobert/Mitten](https://github.com/joobert/Mitten) |
| `repo-commit-watcher` | automation | node | Code · Debug Garage | **yes** | [joobert/Mitten](https://github.com/joobert/Mitten) |

`catalog.json` is the machine-readable list — the frontend reads it to spawn buildings.

## Event contract (NDJSON)

Every bot writes one JSON object per line to **stdout**:

```json
{ "ts": "<iso8601>", "bot": "<id>", "type": "bot.log|bot.metric|bot.signal|bot.alert|bot.item", "data": { } }
```

- `bot.log` — lifecycle / status (`data.level`, `data.msg`)
- `bot.metric` — numbers for the dashboard (price, equity, latency, counts…)
- `bot.signal` — trading buy/sell decisions (paper)
- `bot.alert` — security / health alerts (`data.severity`)
- `bot.item` — new discovered item (feed entry, commit)

Map these onto the same SSE event model as agent tasks (see `../../docs/FRONTEND.md`): a bot's
`bot.log`/`bot.metric` lines become events on the stream; its `bot.metric` numbers feed
the Monitoring Center. Bots emit **real** activity — no fictional currency or XP.

All scripts honor `SIGINT`/`SIGTERM` for clean start/stop, and take `--interval` plus a
`--max-ticks`/`--max-polls` cap for bounded test runs.

## Run one directly (before the Bot Runner exists)

```bash
# trading (offline, 3 ticks)
python3 scripts/paper_trader.py --symbol BTC-USD --cash 10000 --interval 1 --max-ticks 3
node   scripts/market_signal.mjs --symbol ETH-USD --interval 2

# security (offline, reads the bundled sample log)
python3 scripts/log_watchtower.py --source sample-data/auth.sample.txt

# networked
node   scripts/http_healthcheck.mjs --targets https://example.com,https://api.github.com
python3 scripts/rss_watcher.py --feed https://hnrss.org/frontpage
node   scripts/repo_commit_watcher.mjs --repo freqtrade/freqtrade   # optional GITHUB_TOKEN env raises rate limit
```

Offline bots (`paper-trader`, `market-signal`, `log-watchtower`) need no network or keys
— ideal for demoing the city anywhere. Networked bots only issue read-only GETs to the
targets you pass.

## For Codex — wiring into the Bot Runner

A bot = another managed runtime next to AI agents. Suggested `POST /api/v1/bots` body
mirrors a catalog entry: `{ name, kind, runtime, entry, args, env, schedule, district,
paperMode, networkRequired }`. The runner should:

1. Spawn with **`spawn(cmd, args)` — never a shell string** (no interpolation), `cwd` set
   to this bots dir, inherited env filtered to declared `env` keys only.
2. Read stdout line-by-line, `JSON.parse` each line into a bot event, persist + stream it
   on the SSE bus (reuse `execution_events` / `usage_records` shape).
3. Enforce start/stop (SIGTERM then SIGKILL on timeout), health (last-event age), and the
   `schedule.everySeconds` cadence.
4. Keep **trading bots paper-only**; a live-trading bot needs separate credentials and an
   explicit human approval event, exactly like destructive agent ops.
5. Treat networked bots' output as untrusted; cap line length and total output.

Seed the catalog on first run so the city opens already populated.

RSS and repository watchers retain at most 10,000 item IDs by default; use
`--history-limit` to change that bound. Dedupe covers this retained history, so
an old item can be reported again after eviction. RSS responses are limited to
4 MB. Node network bots cancel active requests on SIGTERM, and the RSS watcher
interrupts its blocking fetch when Python handles the shutdown signal. A runner
should still enforce its own stop deadline, particularly during system DNS calls.
The market signal bot stops immediately regardless of its tick interval. Log
watchtower metrics report the highest observed severity, or `none` for clean logs.
