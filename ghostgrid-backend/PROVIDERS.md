# Provider integrations

These adapters call real supported interfaces. Mock explicitly simulates inference; it never executes code. No credits, currency, or invented token counts are implemented.

## Official references verified during implementation

- [Codex SDK](https://developers.openai.com/codex/sdk/) and [official TypeScript SDK source](https://github.com/openai/codex/tree/main/sdk/typescript): `startThread`, `resumeThread`, `runStreamed`, per-turn `signal`, sandbox and approval settings.
- [Claude Agent SDK TypeScript reference](https://docs.claude.com/en/docs/agent-sdk/typescript): `query`, `resume`, `abortController`, tool selection, `PreToolUse`, `canUseTool`, result usage.
- [DeepSeek chat completions](https://api-docs.deepseek.com/api/create-chat-completion/) and [model discovery](https://api-docs.deepseek.com/api/list-models/): streaming chat completions, usage, `/models`.

## Configuration and authentication

Install optional SDKs with `pnpm add @openai/codex-sdk @anthropic-ai/claude-agent-sdk` if your installation omitted them. Codex uses supported local `codex login` authentication when no key reference is supplied. Claude uses supported local authentication or `ANTHROPIC_API_KEY`. No account files, browser cookies, or credentials are extracted. Availability checks for SDKs confirm installation only; authentication and native binary availability are checked by the SDK when execution starts.

DeepSeek requires an explicit model ID and `apiKeyEnv: "DEEPSEEK_API_KEY"`; discover current IDs with the provider test endpoint. The default base URL is `https://api.deepseek.com`. Generic endpoints require an explicit model and may set `auth: "none"` for a local unauthenticated server. URLs must include the API prefix when required, for example `http://127.0.0.1:11434/v1`. Generic `/models` is used by the test endpoint by default. Set `supportsModelDiscovery: false` for servers without discovery, and `supportsStreaming: false` for nonstreaming chat APIs. Capabilities report the configured streaming support; execution permits compatible servers without model discovery.

## Execution permissions and limits

Codex defaults to a read-only sandbox, untrusted approval policy, disabled network and web search. A write agent receives the SDK workspace-write sandbox. The SDK subprocess interface cannot surface interactive approval decisions through this backend: operations requiring an SDK approval may fail. `approvals` capability therefore reports false. Do not weaken approvals to resolve that failure. Use an operator-controlled terminal or implement the Codex app-server approval protocol later. Read-only sandboxes can still read files beyond a working directory; the workspace allowlist governs the selected directory, not all host file visibility. Only use trusted local repositories with this MVP; production needs an OS-level isolated executor.

Claude permits only Read/Glob/Grep, with pre-tool checks against the workspace, and exposes Edit/Write only for write agents. Write/Edit require an explicit agent write grant and an isolated Git worktree supplied by the execution engine. Both pre-tool hooks and permission callbacks validate paths, including new parent paths and symlink escapes, and reject Git metadata, agent settings, environment files, credentials and key files. Source-workspace writes and restricted tools remain denied with audit events; there is no live approval-resolution API for sensitive operations. Shell, subagents, web tools and notebook execution are disabled. Project settings and MCP servers are not loaded.

Recursive Grep/Glob first inspect every entry in the selected subtree, asynchronously, with a 10,000-entry and 64-level budget. Any sensitive entry, symlink, special file or exceeded budget denies the entire search before the native tool runs. A normal repository root containing `.git` is therefore unavailable for broad search: select a clean source subdirectory such as `src`, or use Grep/Read on an explicit safe file. Glob accepts relative wildcard patterns without traversal, brace expansion or extglob groups. Hooks pass canonical checked paths through the SDK's `updatedInput`. These checks cover static trees; another process can still change paths between inspection and tool execution. Production requires filesystem isolation to guarantee containment against concurrent malicious mutations.

Neither direct inference adapter executes model tool calls. They report `coding: false` and `tools: false`. OpenCode is an optional future integration, not a simulated agent. Generic compatibility varies: unsupported request fields, malformed streams and truncated completions produce failures. HTTP 429 and 5xx are marked transient; the task engine decides whether retries are safe. API output and error bodies are untrusted and credential-bearing HTTP error bodies are not returned.

## Manual integration verification (may incur provider usage)

1. Install the relevant SDK and authenticate through its supported tooling, or export the referenced API key.
2. Create the provider with `type`, `model` if needed, `apiKeyEnv` if using a key, and optionally `baseUrl`.
3. Test it through `POST /api/v1/providers/:id/test`; inspect discovery/status without assuming authentication is confirmed for SDK providers.
4. Create a read-only agent in an allowlisted project, create a session, submit "Reply with a brief greeting", and inspect SSE and saved result.
5. Submit another message to the same session. Coding providers resume their native session ID; inference providers receive persisted conversation history from the backend.
6. Submit a long task, cancel it, and confirm cancellation status. Verify token counts against returned provider usage. Never interpret unknown usage as zero.

Real integration verification requires credentials and compatible installed SDK/native binaries; the normal test suite uses mock and local HTTP fixtures only.

### Opt-in automated smoke tests

Set `GHOSTGRID_LIVE_TEST=1` plus `GHOSTGRID_LIVE_WORKSPACE` pointing to a trusted Git workspace, and the relevant `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. For DeepSeek set `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL`. Run `pnpm exec vitest run tests/providers.live.test.ts`. Tests send one minimal greeting prompt per enabled provider and may incur usage. Without explicit opt-in or the matching credentials they skip. Workspace restrictions are enforced by the HTTP execution engine; this direct adapter smoke test is for an explicitly selected trusted local workspace.

## Connecting additional APIs

Any OpenAI-compatible chat API can be registered through configuration without changing orchestration. Supports bearer authentication, `auth: "header"` with `apiKeyHeader` and `apiKeyEnv` (for example Azure `api-key`), or `auth: "none"`. `headersEnv` maps custom header names to environment variables, keeping header secrets out of SQLite. `queryParameters` accepts non-secret routing/version parameters such as Azure `api-version`. Set the base URL to the endpoint's API or deployment root; the adapter appends `/chat/completions`. Header syntax and line breaks are checked; credentials in query parameters are refused. SDK subprocess environments omit unrelated credential variables, and inherited Codex MCP servers are disabled through its supported config override.

“Any API” does not mean arbitrary incompatible response protocols can be inferred automatically. APIs using Anthropic Messages, Gemini-native or proprietary request/response formats need an adapter or OpenAI-compatible gateway. Capabilities and errors report actual support; configuration does not turn inference into an autonomous coding agent.

Claude gateway URLs are forwarded through the SDK-supported `ANTHROPIC_BASE_URL`; only HTTPS or loopback HTTP is accepted. Claude SDK `total_cost_usd` is an estimated cumulative session total and can include previous resumed turns. Ghost Grid does not record it as a billed task cost or sum it across tasks. Actual Claude billed cost remains unknown; configured token pricing may provide separately labelled estimates.

## Connectivity checks without inference

Run `npm run check:providers` with `GROQ_API_KEY` and/or `DEEPSEEK_API_KEY` in
an ignored `.env` or the process environment. Missing keys are reported as skipped.
The command sends only authenticated GET requests to the model-list endpoints,
with a 15-second timeout, bounded response parsing and redirects refused. It prints
model identifiers and status, never credential values, and exits nonzero on failed
checks. It does not create providers, start workers or submit generation tasks.
Successful discovery confirms endpoint access and authentication; generation and
billing are not tested. Paid smoke tests remain separately opt-in.

Groq uses the existing `openai-compatible` adapter with
`baseUrl: "https://api.groq.com/openai/v1"` and `apiKeyEnv: "GROQ_API_KEY"`.
Select a model from the returned live list before creating an inference provider.
References: [Groq model discovery](https://console.groq.com/docs/models),
[DeepSeek model discovery](https://api-docs.deepseek.com/api/list-models/).
