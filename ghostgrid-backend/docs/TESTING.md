# Backend validation

Run the full offline verification from `ghostgrid-backend`:

```sh
pnpm verify
```

`npm run verify` also works with installed dependencies. Verification uses the
invoking package manager and stops at the first failed or interrupted check.

It checks TypeScript and script syntax, runs the test suite, builds production
JavaScript and copies migrations, validates compiled startup/persistence, runs a
complete HTTP integration check, and executes the mock demo. Each check uses
temporary storage. It never opens the application's existing database or makes
paid model calls.

To run individual checks:

```sh
pnpm test
pnpm check
pnpm build
pnpm test:http
```

`test:http` needs the preceding build. It starts the compiled Fastify app on an
ephemeral loopback port, sends real authenticated HTTP requests, tests browser
preflight, creates two building-specific conversations, passes shared context
through messages and a workflow, checks artifacts/usage, replays SSE with
`Last-Event-ID`, saves and restores session notes, and restarts against its temporary database. It closes the server
and removes its fixture data afterward.

## Feature coverage

| Feature | Validation |
| --- | --- |
| Provider configuration | Unknown types, invalid concurrency, credential references, forbidden plaintext secrets, auth headers, model discovery and configurable gateways |
| Codex sessions | Mocked official SDK through the complete HTTP-handler/queue/storage path: native IDs, resume, isolated buildings, coding events, cancellation and permissions |
| Claude sessions | Mocked official SDK through the same path: native IDs, resume, custom gateway, tool restrictions and cumulative cost handling |
| DeepSeek/custom APIs | Real local HTTP discovery/chat/SSE fixtures: authentication, streaming chunks, follow-up conversation history, session isolation, usage and failures |
| Projects/agents/buildings | Workspace allowlists, read/write permissions, unique building ownership, project/provider references, changes and history filters |
| Session managers | Independent named sessions per building, renaming, archive/resume/cancel, ownership checks, scoped history, atomic lifecycle events and restart persistence |
| Tasks | Async creation, queue/provider limits, state transitions, dependencies, durable cancellation before provider abort, deadlines, transient inference retries, output/artifact persistence and interrupted-job recovery |
| Workflows | DAG validation, sessions/context per node, handoff outputs, workspace continuity through reviews, terminal aggregation, cancellation and transaction rollback |
| Shared context/library | Explicit project-scoped references, provenance, saved-note/paper imports, bounded upstream responses, unsupported query rejection and no original-library mutation |
| Monitoring/events | Unknown usage stays unknown; configurable estimates; paginated metrics; scoped REST history/SSE delivery, durable cursors, library/context notifications and replay after restart |
| Security/storage | Secret redaction, path/symlink restrictions, authentication, CORS/Host restrictions, referential integrity, migrations, locking and transaction failures |
| API contract | Zod validation, consistent errors, OpenAPI request/response schemas, parameter limits, event cursors and atomic scoped topology changes |

`tests/features-api.test.ts` contains public-API invalid-input cases and a combined
session/context/workflow/artifact check. `tests/provider-api.integration.test.ts`
tests sessions across every implemented provider type. The remaining test files
exercise provider protocols, execution, session lifecycles, library routes,
storage/security, OpenAPI and standalone example scripts in more depth.

## Optional external checks

The regular suite cannot verify account authentication, rate limits, or native
SDK subprocess behavior against live paid providers. For the explicit opt-in
credential tests, follow [PROVIDERS.md](PROVIDERS.md). Their omission is reported
as skipped tests, not a successful live connection.

To test the actual pinned Python Library of Babel backend and its read-only HTTP
bridge with synthetic data, follow [LIBRARY.md](LIBRARY.md). That optional check
requires its trusted source checkout and Python dependencies. The bridge copies
only selected metadata to a temporary snapshot; refresh it by restarting the
bridge after changing the source collection.

CI runs both bridge tests in a separate Python 3.14 job with the upstream revision
pinned to `553a934874d8d11e1b5eac4c7daef5c4dad0eb6c` and dependencies pinned in
`tests/requirements-news-bridge.txt`. To reproduce its Python environment locally,
install that requirements file in a temporary virtual environment before running
the unittest command in LIBRARY.md. Browser binaries are not needed for these tests.
