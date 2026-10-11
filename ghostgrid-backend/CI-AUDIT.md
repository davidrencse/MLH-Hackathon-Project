# Project and pipeline audit — 2026-10-11

This follow-up covers the entire application in this workspace: API/configuration,
SQLite schema and migrations, scheduler/workflows, sessions, provider adapters,
filesystem/authentication boundaries, library proxy/bridge, example bots, utility
scripts, dependency lockfile, documentation, tests and build tooling. Existing
application changes were preserved. The earlier [AUDIT.md](AUDIT.md) is historical;
the current code has already corrected several of its remaining findings.

## Changes made in this pass

- Added GitHub Actions CI for Node 22 and 24 with frozen pnpm installations,
  TypeScript checks, standalone JavaScript/Python syntax checks, tests, production
  builds, compiled HTTP/persistence checks and mock integration execution.
- Added dependency security checks for every push/PR, manual dispatch and weekly
  schedule. All dependencies, including development and optional packages, are
  audited; high/critical vulnerabilities cause failure. Audit service errors also
  fail rather than masquerading as a successful scan.
- Added weekly Dependabot updates for npm packages and GitHub Actions. Actions
  are pinned to verified commit SHAs. Workflows have read-only contents permissions,
  no stored checkout credentials, job deadlines and cancellation of obsolete runs.
- Added a build artifact from the successful Node 24 job, containing compiled
  sources, SQL migrations, package manifest and lockfile.
- Added `pnpm verify`, `pnpm check:scripts` and `pnpm test:built`. Typechecking now
  includes TypeScript utility scripts. This caught and fixed unsafe property access
  on the provider-connectivity script's availability response union. Combined-tree
  checks also fixed session-summary return-type inference and JSON payload typing
  in the newly added feature API test helper. The workspace-denial test now expects
  the correct 403 status. Python cache files are ignored.
- Updated `tsx` from 4.21.0 to 4.23.15 and the lockfile, resolving esbuild to
  0.28.2. The full initial audit found the low-severity Windows development-server
  traversal advisory [GHSA-g7r4-m6w7-qqqr](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr).
  The final dependency audit reports no known vulnerabilities.

## Verification evidence

The CI command sequence was executed using pnpm 10.18.3 against an isolated copy
with dependencies installed from the frozen lockfile, using actual Node 22.23.3
and Node 24.21.0 runtimes. Both pass the complete sequence:

| Check | Node 22.23.3 | Node 24.21.0 |
| --- | --- | --- |
| Frozen lockfile install | Pass | Pass |
| Typecheck and script syntax | Pass | Pass |
| Vitest | 172 passed, 3 live tests skipped | 172 passed, 3 live tests skipped |
| Production build | Pass | Pass |
| Compiled HTTP/persistence smoke | Pass | Pass |
| Full compiled HTTP integration | Pass | Pass |
| Mock integration demo | Pass | Pass |

The full npm dependency audit reports zero known vulnerabilities. Workflow validation,
Dependabot YAML parsing and staged/unstaged whitespace checks pass. External edits
were present during the audit and were preserved; the final matrix includes the
combined application and test changes.

`actionlint` 1.7.12 accepts both workflows. The compiled smoke check verifies a real
HTTP listener, rejection without a bearer token, authenticated readiness, project
creation, clean shutdown/database-lock release and persistence after reopening.
All test storage is temporary; no application database is opened by these checks.

## Current findings and limits

| Area | Current assessment |
| --- | --- |
| Recursive Claude tools | Descendants are checked for sensitive names, symlinks and scan budgets before recursive reads. This fixes the earlier root-only check. A preflight file scan is still subject to concurrent filesystem mutation; it is not an OS security boundary. Codex read scope also remains broader than the configured workspace root. Untrusted code execution requires a separately isolated environment. |
| Storage/performance | Current code pages entities and usage in SQL, aggregates metrics/session counts, and indexes scoped event replay. These supersede the previous full-history JSON-decoding findings. Synchronous SQLite aggregate/count queries can still grow with history; no production load certification is implied. |
| Conversations/retention | Provider prompt history is bounded, but stored session message arrays are not. Long-running sessions grow in database size and rewrite cost. Worktree/artifact/event retention also needs an explicit product policy. Bot deduplication windows are now bounded. |
| Schema/contracts | Drizzle declares the runtime indexes and dependency uniqueness. Tasks now default their title. Existing contract tests verify documented shapes, but do not validate every response for every endpoint against OpenAPI. |
| Provider behavior | Mock and local HTTP-fixture tests cover timeouts, streaming, cancellation, retries and execution scheduling. Three paid/authenticated provider smoke tests remain skipped; native SDK execution is not certified. Shutdown relies on providers cooperating with abort. |
| Library bridge | Both Python tests pass against upstream revision `553a934874d8d11e1b5eac4c7daef5c4dad0eb6c`, using Python 3.14 and pinned test dependencies. This includes real HTTP read routes and byte-for-byte source metadata preservation. A dedicated CI job now runs these tests instead of skipping them. |
| Example bots | Examples are standalone scripts; there is no managed bot service. CLI numerical arguments such as trading cash/periods could use stricter validation. Current tests cover representative parsing, simulation, deduplication and shutdown behavior. |
| Hosted CI | No Git remote is configured in this checkout. Workflow syntax and executable steps were checked locally; GitHub-hosted checkout/cache/artifact upload and Dependabot execution require pushing the repository to GitHub. There is no deployment destination configured. |

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --audit-level=high
actionlint .github/workflows/ci.yml .github/workflows/security.yml
git diff --check
git diff --cached --check
```

Python 3 is required for bot fixtures and script syntax checks. CI selects Python
3.12 for the Node jobs and Python 3.14 for the bridge job; the local runs used the
available Python 3.14 interpreter. Bridge test dependencies are pinned in
`tests/requirements-news-bridge.txt`. Both bridge tests were run in a temporary
virtual environment. See `tests/test_news_bridge.py` and [LIBRARY.md](LIBRARY.md).

CI now calls `pnpm verify` directly so newly added verification steps, including
`test:http`, run in the pipeline automatically. Three live-provider tests still
require explicit paid-provider opt-in and matching credentials; their skip is
reported separately from passing deterministic tests.
