# Efficiency and integration audit — 2026-10-11

For the later project/pipeline audit, current findings and clean-install runtime
verification, see [CI-AUDIT.md](CI-AUDIT.md). The findings below record the earlier
snapshot; several have since been fixed in the application.

Scope: all code under `/home/czr/projects/hackathon/`, which currently contains
`ghostgrid-backend`: API, sessions, scheduler, SQLite storage/migrations, providers,
security boundaries, build/start scripts, standalone example bots and documentation.
Concurrent work added a library integration; its local unit/API tests, upstream
response validation and OpenAPI descriptions are included in the final checks.
Three parallel agents reviewed scheduler/concurrency, API/session integration, and
providers/bots; the primary agent reviewed storage, performance and combined checks.

## Verified result

- Baseline: 47 tests passed, 3 live-provider tests skipped; typecheck and build passed.
- Final suite: 111 tests passed, 3 live-provider tests skipped across 11 test files.
- Python upstream-bridge test discovery succeeds with one test skipped because no
  explicit upstream checkout was supplied.
- Typecheck, production build, integration demo and whitespace check pass. A compiled
  application boot test also verifies copied SQLite migrations and `/health`.
- Tests cover independent-task concurrency, shared-session serialization, provider
  caps, cancellation, shutdown, retries, dependencies, worktree reuse, persistence,
  SSE replay, browser origin/auth handling and bot shutdown using local fixtures.
- Paid/native authenticated provider execution was not exercised. There is no frontend
  application here, so browser UI behavior cannot be certified by backend tests.

Passing checks establish tested behavior; they do not establish absence of every race
or prove unlimited-load performance. Remaining findings below are part of this audit.

## Fixed findings

| Finding | Correction and evidence |
| --- | --- |
| Cancelled work could still dispatch after `task.started` | Abort checked immediately before provider dispatch; deterministic regression verifies zero calls |
| Scheduler snapshots could overwrite cancellation | Queued state rechecked before admission; event-listener cancellation regression verifies no task resurrection |
| Terminal task/event/workflow writes could diverge | Atomic transaction plus startup reconciliation; injected persistence failures prove rollback and recovery without replay |
| Event insert could persist without its replay sequence | Event insertion and sequence persistence now atomic; failure injection leaves no partial event |
| Failed `BEGIN` corrupted transaction nesting state | Depth increment follows successful `BEGIN`; regression verifies subsequent transactions work |
| Scheduler filtered by decoding entire task/dependency histories | Mapped filters and task status pushed into SQLite; scheduler uses filtered queries; query-plan and decode-count tests confirm indexed status lookup |
| Session list repeatedly scanned tasks and enriched off-page sessions | Task histories grouped once and only requested page enriched; regression counts storage calls |
| Global timeout/retry environment settings had no effect | Config defaults passed to scheduler; explicit task overrides still honored |
| Explicit session creation was invisible to events | Scoped `session.created` event emitted and tested |
| Message/session validation disagreed across runtime and contract | Shared message schema and consistent 160-character name/title limits |
| Browser origin blanket rejection broke documented proxy integration | Exact opt-in origin allowlist, preflight and SSE headers; default remains closed; actual bearer authentication remains required |
| Provider auth headers could select transport headers | Validation rejects transport/content-type headers; adapter enforces the same restriction |
| Completed provider stream waited for HTTP EOF | `[DONE]` completes and cancels reading; later frames ignored and cleanup rejection does not discard successful output |
| Provider stream chunk boundaries and final output limits | UTF-8/CRLF boundary handling and pre-emission output bounds tested; nonstreaming output also validated/bounded |
| Aborted tasks could enter provider work/import races | Abort checked at adapter entry and after asynchronous SDK load |
| DeepSeek ignored disabled discovery during execution | `supportsModelDiscovery:false` now honored on execution as well as availability checks |
| HTTP/repository example bots did not abort active fetch on shutdown | Abort controllers tied to signals; repository requests also have deadlines; subprocess fixture tests verify exit |
| Atom feed item links ignored `href` | Atom alternate link parsing fixed and tested |
| Startup/environment documentation absent | README and `.env.example` added; frontend instructions corrected |
| Dashboard reads repeatedly decoded historical task outputs | SQL pagination, task-ownership usage joins, scoped session aggregates and projected metrics remove per-record task lookups |
| Event replay for session/project/agent scanned global history | Expression indexes and SQL scope filters introduced in versioned migration `0002.sql`; authoritative sequence columns also repair legacy cursors |
| Metric durations grew without a response bound | Duration pages default to 100, maximum 500; global counts remain global; page totals and offsets documented |
| Drizzle declarations differed from runtime SQL | All named indexes, dependency uniqueness and FK actions aligned; schema parity and existing-v1 migration tests added |
| Native recursive coding tools could search nested sensitive files | Complete bounded asynchronous subtree inspection rejects sensitive entries, symlinks and special files; canonical tool inputs propagated through SDK hooks |
| Bot severity, memory and shutdown behavior | Highest-severity metric, bounded RSS/repository deduplication, 4 MB RSS response cap and responsive RSS/market shutdown tested offline |
| Artifact metadata failures left orphan output files | Unregistered output files removed on failure/cancellation; actual consumed provider usage retained |
| Auto-created sessions lacked topology events; messages could create untitled tasks | Scoped session event added and default task title unified |
| New library operations had inconsistent browser/contract behavior | PUT preflight supported; library identifiers, response types, queries and upstream errors documented accurately |
| Malformed library payloads caused internal errors | Notes/paper payload shapes validated as upstream failures; paper display titles fit the shared limit while metadata remains intact |

## Measured efficiency improvement

Run `pnpm exec tsx scripts/benchmark-storage.ts` (or
`node_modules/.bin/tsx scripts/benchmark-storage.ts`). It creates an in-memory database
with 10,000 tasks, 10 queued tasks and approximately 1 KB of output per task. Twenty
warm samples compare the previous full-table decode/filter with indexed status filtering.

Observed medians on this machine: **48.96 ms before, 0.069 ms after**, approximately
**706× faster for this query**. JSON rows decoded drop from **10,000 to 10**.
This measures one synthetic queue lookup, not overall application speed or a production
load test. Other filters without matching indexes may still scan within SQLite.

## Remaining limits

1. **Filesystem isolation:** Claude checks static directory trees, but an external
   process can change files between inspection and use. Codex host-read scope is also
   broader than the selected workspace. An OS-level executor boundary is still needed
   for untrusted repositories. Native root searches containing `.git` or sensitive
   files are now denied; use a safe subtree or explicit file. This behavior is tested
   and documented rather than claiming that a path hook is a complete sandbox.

2. **Conversation retention:** provider input is bounded, but full session messages
   still grow in each persistent session JSON record. Changing retention would change
   existing history behavior, so this audit preserves it. A future append-only message
   table plus paginated history would avoid repeated serialization without losing
   conversations. Bot deduplication is now bounded; IDs evicted from the configured
   history window can be announced again.

3. **Scaling and supervision:** SQLite remains synchronous and single-owner. Indexed
   reads avoid unnecessary decoding, but global aggregates still cost work proportional
   to relevant history. The benchmark does not establish a maximum production load.
   Shutdown relies on adapters honoring abort. Python system DNS calls may postpone
   signal handling. The standalone examples still have no managed `/api/v1/bots` runner.

4. **External verification:** real authenticated provider/native SDK execution and
   the opt-in upstream news bridge remain unverified in this run. Local fixtures
   cover the backend contracts, not an actual frontend or live external deployment.

## Reproduce checks

```sh
npm test
npm run check
npm run build
npm run demo
node_modules/.bin/tsx scripts/benchmark-storage.ts
git diff --check
```

The pnpm binary was unavailable in this environment; npm scripts used the existing
installed dependencies without modifying the lockfile. Concurrent external edits
appeared during the audit; they were preserved and the combined working tree was
checked. No deployment, paid provider calls or application database changes were made.
