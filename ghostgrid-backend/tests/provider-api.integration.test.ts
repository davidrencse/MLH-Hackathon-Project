/** Real loopback HTTP inference fixtures and mocked official coding SDKs.
 * No upstream provider calls, credentials, SDK subprocesses, or paid usage. */
import { createServer } from "node:http";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
const sdkCalls = vi.hoisted(() => ({
  codex: [] as { session?: string; prompt: string }[],
  claude: [] as { session?: string; prompt: string }[],
}));
vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    startThread() {
      return this.thread();
    }
    resumeThread(session: string) {
      return this.thread(session);
    }
    thread(session?: string) {
      return {
        runStreamed: async (prompt: string) => {
          sdkCalls.codex.push({ session, prompt });
          const id = session ?? `codex-native-${sdkCalls.codex.length}`;
          return {
            events: (async function* () {
              yield { type: "thread.started", thread_id: id };
              yield {
                type: "item.started",
                item: { type: "command_execution", command: "fixture-read" },
              };
              yield {
                type: "item.completed",
                item: { type: "command_execution", command: "fixture-read" },
              };
              yield {
                type: "item.completed",
                item: {
                  type: "agent_message",
                  text: `Codex fixture ${prompt}`,
                },
              };
              yield {
                type: "turn.completed",
                usage: { input_tokens: 12, output_tokens: 4 },
              };
            })(),
          };
        },
      };
    }
  },
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionInfo: async (id: string) => ({ sessionId: id }),
  query: async function* ({
    prompt,
    options,
  }: {
    prompt: string;
    options: { resume?: string };
  }) {
    sdkCalls.claude.push({ session: options.resume, prompt });
    const id = options.resume ?? `claude-native-${sdkCalls.claude.length}`;
    yield { type: "system", subtype: "init", session_id: id };
    yield {
      type: "assistant",
      message: {
        content: [{ type: "text", text: `Claude fixture ${prompt}` }],
      },
    };
    yield {
      type: "result",
      subtype: "success",
      session_id: id,
      result: `Claude fixture ${prompt}`,
      usage: { input_tokens: 12, output_tokens: 4 },
      total_cost_usd: 999,
    };
  },
}));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
  sdkCalls.codex.length = sdkCalls.claude.length = 0;
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ghostgrid-provider-api-"));
  const workspace = join(dir, "workspace");
  mkdirSync(workspace);
  const { app } = await buildApp({
    config: loadConfig({
      GHOSTGRID_DATA_DIR: dir,
      GHOSTGRID_ALLOWED_WORKSPACES: workspace,
    }),
    logger: false,
  });
  cleanup.push(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = async (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
    status = method === "POST" ? 201 : 200,
  ) => {
    const response = await app.inject({
      method,
      url,
      ...(payload ? { payload } : {}),
    });
    expect(response.statusCode, response.body).toBe(status);
    return response.json();
  };
  const project = await request("POST", "/api/v1/projects", {
    name: "Provider integration",
    workspace,
  });
  const wait = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const task = await request("GET", `/api/v1/tasks/${id}`);
      if (task.status === "completed") return task;
      if (["failed", "cancelled"].includes(task.status))
        throw new Error(JSON.stringify(task));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Fixture execution timed out");
  };
  return { request, project, wait };
}
async function fixture() {
  const calls: {
    messages: { role: string; content: string }[];
    authorization?: string;
  }[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = "";
    for await (const bytes of req) body += bytes;
    const payload = JSON.parse(body);
    calls.push({
      messages: payload.messages,
      authorization: req.headers.authorization,
    });
    res.setHeader("content-type", "text/event-stream");
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Fixture reply" }, finish_reason: null }] })}\n\n`,
    );
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4 } })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No fixture port");
  return { calls, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}
describe("provider execution through full backend API", () => {
  it.each(["openai-compatible", "deepseek"])(
    "%s uses real loopback HTTP, per-building sessions and conversation replay",
    async (type) => {
      vi.stubEnv("GG_INTEGRATION_API_KEY", "fixture-auth-secret");
      const upstream = await fixture();
      const { request, project, wait } = await setup();
      const provider = await request("POST", "/api/v1/providers", {
        name: type,
        type,
        model: "fixture-model",
        baseUrl: upstream.baseUrl,
        apiKeyEnv: "GG_INTEGRATION_API_KEY",
      });
      expect(
        (
          await request(
            "POST",
            `/api/v1/providers/${provider.id}/test`,
            {},
            200,
          )
        ).available,
      ).toBe(true);
      const sessions = [];
      for (const buildingId of ["tower-a", "tower-b"]) {
        const agent = await request("POST", "/api/v1/agents", {
          name: buildingId,
          buildingId,
          projectId: project.id,
          providerId: provider.id,
        });
        sessions.push(
          await request("POST", "/api/v1/sessions", {
            agentId: agent.id,
            projectId: project.id,
            name: buildingId,
          }),
        );
      }
      for (const [session, prompt] of [
        [sessions[0], "building A private context"],
        [sessions[1], "building B private context"],
        [sessions[0], "A followup"],
      ] as const) {
        const task = await request(
          "POST",
          `/api/v1/sessions/${session.id}/messages`,
          { prompt },
          202,
        );
        const completed = await wait(task.id);
        expect(completed.result).toBe("Fixture reply");
        const events = (await request("GET", `/api/v1/tasks/${task.id}/events`))
          .items;
        expect(events.map((event: { type: string }) => event.type)).toEqual(
          expect.arrayContaining([
            "agent.output",
            "task.completed",
            "usage.updated",
          ]),
        );
      }
      expect(upstream.calls).toHaveLength(3);
      expect(
        upstream.calls.every(
          (call) => call.authorization === "Bearer fixture-auth-secret",
        ),
      ).toBe(true);
      expect(upstream.calls[1].messages).toHaveLength(1);
      expect(
        upstream.calls[2].messages.map((message) => message.content).join(" "),
      ).toContain("building A private context");
      expect(
        upstream.calls[2].messages.map((message) => message.content).join(" "),
      ).not.toContain("building B private context");
      const usage = await request("GET", "/api/v1/usage");
      expect(usage.items).toHaveLength(3);
      expect(usage.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ inputTokens: 12, outputTokens: 4 }),
        ]),
      );
      expect(upstream.calls[2].messages.map((message) => message.role)).toEqual(
        ["user", "assistant", "user"],
      );
      for (const session of sessions) {
        const history = await request(
          "GET",
          `/api/v1/sessions/${session.id}/events`,
        );
        expect(
          history.items.every(
            (event: { sessionId: string }) => event.sessionId === session.id,
          ),
        ).toBe(true);
        expect(
          history.items.map((event: { type: string }) => event.type),
        ).toContain("task.completed");
      }
      expect(JSON.stringify(usage)).not.toContain("fixture-auth-secret");
    },
  );
  it.each(["codex", "claude"] as const)(
    "%s mocked official SDK persists native IDs and resumes only its building session",
    async (type) => {
      const { request, project, wait } = await setup();
      const provider = await request("POST", "/api/v1/providers", {
        name: type,
        type,
      });
      const sessions = [];
      for (const buildingId of ["coding-a", "coding-b"]) {
        const agent = await request("POST", "/api/v1/agents", {
          name: buildingId,
          buildingId,
          projectId: project.id,
          providerId: provider.id,
          permissions: ["read"],
        });
        sessions.push(
          await request("POST", "/api/v1/sessions", {
            projectId: project.id,
            agentId: agent.id,
          }),
        );
      }
      const natives: string[] = [];
      for (const [index, prompt] of [
        [0, "First A"],
        [1, "First B"],
        [0, "Continue A"],
      ] as const) {
        const task = await request(
          "POST",
          `/api/v1/sessions/${sessions[index].id}/messages`,
          { prompt },
          202,
        );
        await wait(task.id);
        const session = await request(
          "GET",
          `/api/v1/sessions/${sessions[index].id}`,
        );
        natives.push(session.providerSessionId);
        const events = (await request("GET", `/api/v1/tasks/${task.id}/events`))
          .items;
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "agent.connected",
              data: expect.objectContaining({
                sessionId: session.providerSessionId,
              }),
            }),
            expect.objectContaining({ type: "agent.output" }),
          ]),
        );
        expect(
          (await request("GET", `/api/v1/tasks/${task.id}`)).sessionId,
        ).toBe(sessions[index].id);
      }
      expect(natives[0]).not.toBe(natives[1]);
      expect(natives[2]).toBe(natives[0]);
      expect(sdkCalls[type].map((call) => call.session)).toEqual([
        undefined,
        undefined,
        natives[0],
      ]);
      expect(
        JSON.stringify(await request("GET", "/api/v1/usage")),
      ).not.toContain('"costUsd":999');
    },
  );
});
