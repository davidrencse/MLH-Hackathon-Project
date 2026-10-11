# Backend hardening — 2026-10-11

This backend is intended for a trusted operator. The API token grants access to
provider configuration, tasks and the configured workspace roots; it is not a
per-user authorization system.

## Controls reviewed and strengthened

- Strict request schemas and UUID route parameters reject malformed API inputs.
  Library article identifiers retain their separate identifier format.
- Tokenless requests require a loopback Host header, including requests without
  an Origin header, to reject DNS rebinding hosts. Remote binding requires a token.
  A reverse proxy using a custom Host header must configure the API token.
- Tokens containing whitespace/control characters fail configuration validation.
  Authentication uses timing-safe comparison; browser origins require an exact
  configured match.
- Unknown-route errors omit request URLs. API responses use `no-store` and
  `nosniff`; internal failures return a generic message.
- Redaction covers registered credential values and common credential key
  spellings, including API keys, refresh tokens, cookies and private keys.
  Environment variable references remain visible so providers can be configured.
- Provider JSON is bounded while reading, before parsing: model lists have a
  2,000,000-byte cap and completion bodies have a 32,000,000-byte cap. Completion
  text retains its 8,000,000-character cap; SSE buffers remain bounded.
- Provider response schemas validate text, model identifiers and nonnegative safe
  integer usage values. Invalid JSON errors do not include response contents.
  Direct adapter use also validates URLs and registers environment credentials.
- Filesystem checks reject traversal, escaping symlinks, dangling symlinks and NUL
  paths. Missing workspaces return a validation error. Filesystem checks do not
  eliminate races with another process changing a path after validation.
- Secret environment-file variants and Python caches are ignored by Git.

## Verification

Verified: 128 backend tests passed, with 3 credential-dependent live tests skipped.
Typecheck, production build, JavaScript/Python syntax checks, integration demo and
compiled HTTP/authentication/migration/persistence smoke test passed. The optional
Python upstream bridge test was skipped because no upstream checkout was supplied.

Run `npm test`, `npm run check`, `npm run check:scripts`, `npm run build`,
`npm run test:built`, `npm run demo`, and `git diff --check`.
Tests use temporary databases, mock providers and HTTP fixtures.
The demo exercises project, agent, session, task, events and usage integration.
Live provider tests require explicitly supplied credentials. The optional Python
news bridge test requires an upstream checkout and its dependencies.

## Boundaries

Coding agents still require a trusted repository and an appropriately isolated
host. Git worktrees isolate edits, but do not provide a complete filesystem or
process security boundary. Native Codex host reads are broader than the workspace
allowlist. Claude recursive searches inspect subtrees, but filesystem races remain.

Provider/library endpoint configuration is trusted: HTTPS and loopback HTTP are
supported, with redirects disabled. Arbitrary HTTPS endpoints are not restricted
to public IP addresses, and environment-referenced credentials are sent to the
configured endpoint. Do not expose configuration access to untrusted users.

There is no per-user authorization, general API rate limiter or automatic history
retention policy. These require a deployment-specific design before operating a
public multi-user service. No live provider execution or deployment is certified
by the local checks.
