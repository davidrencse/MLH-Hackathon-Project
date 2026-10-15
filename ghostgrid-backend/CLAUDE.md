# ghostgrid-backend

@../AGENTS.md

Fastify API over SQLite. It reads the machine it runs on: local coding-CLI processes, their JSONL
transcripts, and provider balances.

```bash
npm run start                 # tsx src/server.ts on 127.0.0.1:3001
npx tsc --noEmit              # typecheck
npx vitest run                # 415 tests; run the whole suite, it takes ~6s
npx vitest run tests/x.test.ts
```

## Conventions

- **Routes are declared with `route()`**, which validates every `:param` as a UUID unless it is
  named `articleId`/`slug`. If your id is not a UUID, take it as a query parameter instead.
- **Never interpolate into SQL.** Table names go through `this.table()` (an allowlist); values are
  always `?` parameters.
- **Paths from disk or from a request go through `safePath()`** in `src/security/index.ts`. It
  rejects traversal *and* resolves symlinks — a string prefix check does not, and that gap was a
  real arbitrary-file-read bug in `office/cliActivity.ts`.
- **Secrets**: keys live in `.env` (gitignored, 0600) and are referenced by `apiKeyEnv` name, never
  stored in records. Use `registerSecret()` so `redact()` can scrub them from responses and logs.
- **`redact()` finds env secrets by NAME**, matching `/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i`.
  A credential that does not advertise itself in its variable name — a `DATABASE_URL`, a DSN, a
  webhook URL with a token in it — is invisible to that heuristic and will print in the clear.
  Every credential this backend reads today happens to match, and provider keys are also passed
  to `registerSecret()` at startup and on every provider write (`registerProviderSecrets` in
  `app.ts`), so there is no live gap. If you add a connection string or any oddly-named
  credential, call `registerSecret()` on it explicitly — do not rely on the name.
- The server binds loopback and rejects non-loopback `Host` headers without a token. Keep that
  guard if you touch `app.ts`'s `onRequest` hook.

## Shared contract

The frontend calls these routes. Changing a response shape breaks another agent's work in
progress — announce it with `SendMessage` and update `src/openapi.ts` in the same edit.
