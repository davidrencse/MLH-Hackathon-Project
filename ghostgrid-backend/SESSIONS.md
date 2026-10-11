# Saved Codex and Claude conversations

Each Slop Angeles session belongs to one agent and project. Separate sessions keep
separate conversations. SQLite saves messages, the provider's native session ID,
session notes, lifecycle events and the isolated coding workspace.

Send follow-up requests to the same Slop Angeles session to continue the conversation:

```http
POST /api/v1/sessions
Content-Type: application/json

{"projectId":"<project UUID>","agentId":"<agent UUID>","name":"Implementation"}
```

```http
PATCH /api/v1/sessions/<session UUID>
Content-Type: application/json

{"memory":"Keep the existing API contract. Use SQLite. Verify cancellation before shipping."}
```

```http
POST /api/v1/sessions/<session UUID>/messages
Content-Type: application/json

{"prompt":"Continue the implementation and check our saved decisions."}
```

Include the configured Bearer token on these requests when authentication is enabled.
`GET /api/v1/sessions/<session UUID>` returns conversation messages, notes and task
counts. `GET /api/v1/agents/<agent UUID>/sessions` lists that agent's conversations.
Notes can contain up to 16,000 characters, can be cleared with `{"memory":""}`, and
can be edited only when the session has no active tasks. They are included in each
later turn, including native resumes and recovery attempts.

## Resume and recovery

Codex uses its SDK's `resumeThread`; Claude passes the saved ID as `resume` and checks
local session metadata when the installed SDK supports `getSessionInfo`. Backend
restart does not erase completed conversation messages or the provider ID.
See the [official Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)
for native thread continuation; local SDK declarations establish the Claude API used here.

If a native session is explicitly missing, Slop Angeles makes one fresh-session attempt
with saved text history and notes, in the same workspace. Recovery retains the last
20 messages within a 32,000-character serialized JSON history budget (including
escaped characters) and saves the replacement native
ID. It does not reconstruct provider tool transcripts or shell state. Full saved
backend messages remain available through the session API.

Changing the provider model, endpoint, credential reference or effective workspace
starts a fresh native conversation with the saved history. This prevents resuming a
conversation under settings it was not created with. `agent.session.recovered` events
and `lastRecovery` on the session show why recovery occurred.

Recovery never runs after emitted output/tool activity, cancellation, an authentication
error or an unrelated execution failure. Interrupted tasks fail on backend restart
so coding actions are not replayed. Archive/resume changes session status; provider
reconnection happens when the next message runs.

Keep the application data directory, native SDK session storage and coding worktrees
when restarting or moving the service. Native sessions may have more context than the
text fallback. Important decisions belong in session notes or project instructions.
This is project persistence, not a promise of memory in unrelated ChatGPT chats.

## Verification

`tests/session-recovery.test.ts` exercises the real adapter classes with synthetic SDK
fixtures and a file-backed SQLite database. It verifies restart, native resume, missing
native-session recovery, model changes, history restoration and the no-replay cases.
Paid/native authenticated execution is a separate live check.
