import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { CodexAdapter } from "../src/providers/codex.js";
import { ClaudeAdapter } from "../src/providers/claude.js";
import { restoredPrompt, withSessionRecovery } from "../src/providers/session-recovery.js";
import type { ExecutionInput } from "../src/providers/types.js";

afterEach(() => vi.restoreAllMocks());
const input: ExecutionInput = {
  prompt: "Continue", sessionId: "missing", messages: [{ role: "user", content: "Remember the blue door" }],
  agent: { id: "agent", permissions: [] }, signal: new AbortController().signal,
};

describe("native session history recovery", () => {
  it("checks Claude's saved session before starting the SDK and restores a missing one", async () => {
    const adapter = new ClaudeAdapter({ id: "p", name: "claude", type: "claude", concurrency: 1, timeoutMs: 1000 });
    const options: any[] = [];
    const getSessionInfo = vi.fn(async () => undefined);
    vi.spyOn(adapter as any, "sdk").mockResolvedValue({
      getSessionInfo,
      async *query(request: any) {
        options.push(request);
        yield { type: "result", subtype: "success", result: "Restored", session_id: "replacement" };
      },
    });
    const result = await adapter.executeTask(input, () => {});
    expect(getSessionInfo).toHaveBeenCalledWith("missing", { dir: undefined });
    expect(options).toHaveLength(1);
    expect(options[0].options.resume).toBeUndefined();
    expect(options[0].prompt).toContain("Remember the blue door");
    expect(result.sessionId).toBe("replacement");
  });
  it.each(["agent.output", "agent.tool.started", "agent.file.changed"])("never replays a missing-session failure after %s", async (type) => {
    const execute = vi.fn(async (_input, emit) => {
      emit(type, { text: "partial" });
      throw new Error("Session not found");
    });
    await expect(withSessionRecovery(input, () => {}, execute)).rejects.toThrow("Session not found");
    expect(execute).toHaveBeenCalledOnce();
  });
  it.each(["Unauthorized", "Connection failed", "Tool failed: file not found", "Tool failed: session not found", "Provider HTTP 401: session not found"])("does not turn %s into a new session", async (message) => {
    const execute = vi.fn(async () => { throw new Error(message); });
    await expect(withSessionRecovery(input, () => {}, execute)).rejects.toThrow(message);
    expect(execute).toHaveBeenCalledOnce();
  });
  it("bounds serialized fallback history even when escaping expands control characters", () => {
    const content = "\0".repeat(2000);
    const prompt = restoredPrompt({ ...input, messages: Array.from({ length: 20 }, () => ({ role: "user" as const, content })) });
    const encoded = prompt.split("\n")[1];
    expect(encoded.length).toBeLessThanOrEqual(32000);
    expect(JSON.parse(encoded)).toHaveLength(2);
    expect(prompt).toContain("Current request:\nContinue");
  });
  it("retains the newest 20 messages without modifying the original history", () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: "user" as const, content: `turn-${index}` }));
    const prompt = restoredPrompt({ ...input, messages });
    const selected = JSON.parse(prompt.split("\n")[1]);
    expect(selected).toHaveLength(20);
    expect(selected[0].content).toBe("turn-10");
    expect(selected.at(-1).content).toBe("turn-29");
    expect(messages).toHaveLength(30);
  });
  it("makes one bounded recovery attempt and retains the original cancellation signal", async () => {
    const execute = vi.fn(async (_input: ExecutionInput) => { throw new Error("Thread not found"); });
    await expect(withSessionRecovery(input, () => {}, execute)).rejects.toThrow("Thread not found");
    expect(execute).toHaveBeenCalledTimes(2);
    const restored = execute.mock.calls[1]?.[0] as ExecutionInput;
    expect(restored.sessionId).toBeUndefined();
    expect(restored.prompt).toContain("Remember the blue door");
    expect(restored.signal).toBe(input.signal);
  });
  it("does not recover after cancellation", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      throw new Error("Thread not found");
    });
    await expect(withSessionRecovery({ ...input, signal: controller.signal }, () => {}, execute)).rejects.toThrow();
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each(["codex", "claude"] as const)("persists %s memory and IDs across restarts, recovers missing sessions, and handles model changes", async (type) => {
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-native-session-"));
    const config = loadConfig({ GHOSTGRID_DATA_DIR: root, GHOSTGRID_ALLOWED_WORKSPACES: root });
    const registry = new ProviderRegistry();
    const calls: { resumed?: string; prompt: string; workspace?: string }[] = [];
    let missing = false;
    let sequence = 0;
    registry.register(type, (provider) => {
      if (type === "codex") {
        const adapter = new CodexAdapter(provider);
        class Codex {
          startThread(options: any) { return this.thread(undefined, options); }
          resumeThread(id: string, options: any) { return this.thread(id, options); }
          thread(resumed: string | undefined, options: any) {
            const id = resumed ?? `codex-native-${++sequence}`;
            return { async runStreamed(prompt: string) {
              calls.push({ resumed, prompt, workspace: options.workingDirectory });
              return { events: (async function* () {
                if (resumed && missing) throw new Error("No rollout found for thread id");
                yield { type: "thread.started", thread_id: id };
                yield { type: "item.completed", item: { type: "agent_message", text: "Saved response" } };
                yield { type: "turn.completed" };
              })() };
            } };
          }
        }
        vi.spyOn(adapter as any, "sdk").mockResolvedValue({ Codex });
        return adapter;
      }
      const adapter = new ClaudeAdapter(provider);
      vi.spyOn(adapter as any, "sdk").mockResolvedValue({
        async *query({ prompt, options }: any) {
          calls.push({ resumed: options.resume, prompt, workspace: options.cwd });
          if (options.resume && missing) throw new Error("No conversation found with session ID");
          const id = options.resume ?? `claude-native-${++sequence}`;
          yield { type: "system", subtype: "init", session_id: id };
          yield { type: "result", subtype: "success", result: "Saved response", session_id: id };
        },
      });
      return adapter;
    });
    let instance = await buildApp({ config, registry, logger: false });
    const request = async (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) => instance.app.inject({ method, url, ...(payload !== undefined ? { payload } : {}) });
    const create = async (url: string, payload: Record<string, unknown>) => {
      const response = await request("POST", url, payload);
      expect(response.statusCode).toBe(201);
      return response.json();
    };
    try {
      const project = await create("/api/v1/projects", { name: "Persistent", workspace: root });
      const provider = await create("/api/v1/providers", { name: type, type, model: "original-model" });
      const agent = await create("/api/v1/agents", { name: type, projectId: project.id, providerId: provider.id });
      const session = await create("/api/v1/sessions", { projectId: project.id, agentId: agent.id });
      expect((await request("PATCH", `/api/v1/sessions/${session.id}`, { memory: "Always use the blue door" })).statusCode).toBe(200);
      const turn = async (prompt: string) => {
        const submitted = await request("POST", `/api/v1/sessions/${session.id}/messages`, { prompt });
        expect(submitted.statusCode).toBe(202);
        const id = submitted.json().id;
        await vi.waitFor(() => expect(instance.store.get("tasks", id)?.status).toBe("completed"), { timeout: 3000 });
        return (await request("GET", `/api/v1/sessions/${session.id}`)).json();
      };
      const first = await turn("Remember our first decision");
      const nativeId = first.providerSessionId;
      expect(nativeId).toBe(`${type}-native-1`);
      await instance.app.close();
      instance = await buildApp({ config, registry, logger: false });
      const resumed = await turn("Continue after restart");
      expect(calls.at(-1)?.resumed).toBe(nativeId);
      expect(resumed.messages).toHaveLength(4);
      expect(resumed.memory).toBe("Always use the blue door");
      missing = true;
      const recovered = await turn("Continue after native file loss");
      expect(calls.at(-2)?.resumed).toBe(nativeId);
      expect(calls.at(-1)?.resumed).toBeUndefined();
      expect(calls.at(-1)?.prompt).toContain("Remember our first decision");
      expect(calls.at(-1)?.prompt).toContain("Always use the blue door");
      expect(calls.at(-1)?.workspace).toBe(root);
      expect(recovered.providerSessionId).toBe(`${type}-native-2`);
      expect(recovered.lastRecovery.reason).toBe("native_session_missing");
      expect(recovered.messages).toHaveLength(6);
      missing = false;
      expect((await request("PATCH", `/api/v1/providers/${provider.id}`, { model: "new-model" })).statusCode).toBe(200);
      const changed = await turn("Continue after settings change");
      expect(calls.at(-1)?.resumed).toBeUndefined();
      expect(calls.at(-1)?.prompt).toContain("Remember our first decision");
      expect(changed.lastRecovery.reason).toBe("provider_configuration_changed");
      expect(changed.providerSessionId).toBe(`${type}-native-3`);
    } finally {
      await instance.app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
