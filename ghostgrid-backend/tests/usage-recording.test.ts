import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db/store.js";
import { Engine } from "../src/execution/engine.js";
import { ClaudeAdapter } from "../src/providers/claude.js";
import { CodexAdapter } from "../src/providers/codex.js";
import { OpenAICompatibleAdapter } from "../src/providers/openai-compatible.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { resolvePricing } from "../src/providers/pricing.js";
import { attachUsage, usageFromError } from "../src/providers/usage.js";
import { ProviderError, type ExecutionInput, type ProviderConfig } from "../src/providers/types.js";

const config: ProviderConfig = {
  id: "p",
  name: "test",
  type: "openai-compatible",
  model: "test",
  auth: "none",
  baseUrl: "https://fixture.invalid/v1",
  concurrency: 1,
  timeoutMs: 1000,
};
const input: ExecutionInput = {
  prompt: "Hello",
  messages: [],
  agent: { id: "a", permissions: [] },
  signal: new AbortController().signal,
};
/** Fake server: one SSE response, plus the request body the adapter sent. */
function stream(...frames: unknown[]) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join(""));
  });
  return sent;
}
const content = (text: string) => ({ choices: [{ delta: { content: text } }] });
const stop = { choices: [{ delta: {}, finish_reason: "stop" }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenAI-compatible token accounting", () => {
  it("asks every streaming endpoint for its token counts, not only DeepSeek", async () => {
    const sent = stream(content("hi"), stop, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }, "[DONE]");
    const result = await new OpenAICompatibleAdapter(config).executeTask(input, () => {});
    // Without stream_options.include_usage a Groq-style endpoint streams no usage at
    // all, which is what left every request recorded as unknown tokens.
    expect(sent[0].stream_options).toEqual({ include_usage: true });
    expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 3 });
  });
  it("does not ask nonstreaming endpoints for stream options", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body)).stream_options).toBeUndefined();
      return new Response(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { input_tokens: 11, output_tokens: 4 } }));
    });
    const result = await new OpenAICompatibleAdapter({ ...config, supportsStreaming: false, supportsModelDiscovery: false }).executeTask(input, () => {});
    // Gateways that name the halves the way the Responses API does are read too.
    expect(result.usage).toMatchObject({ inputTokens: 11, outputTokens: 4 });
  });
  it("reads Groq's x_groq usage block on the final chunk", async () => {
    stream(content("hi"), stop, { choices: [], x_groq: { usage: { prompt_tokens: 51, completion_tokens: 36, total_tokens: 87 } } }, "[DONE]");
    const result = await new OpenAICompatibleAdapter(config).executeTask(input, () => {});
    expect(result.usage).toMatchObject({ inputTokens: 51, outputTokens: 36 });
  });
  it("completes the missing half of the split from a reported total", async () => {
    stream(content("hi"), stop, { choices: [], usage: { prompt_tokens: 40, total_tokens: 55 } }, "[DONE]");
    const result = await new OpenAICompatibleAdapter(config).executeTask(input, () => {});
    expect(result.usage).toMatchObject({ inputTokens: 40, outputTokens: 15 });
  });
  it("reports cached prompt tokens without adding them to the prompt total twice", async () => {
    stream(content("hi"), stop, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } } }, "[DONE]");
    const result = await new OpenAICompatibleAdapter(config).executeTask(input, () => {});
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 10, cachedInputTokens: 80, costUsd: null });
  });
  it("never erases a reported count with a later silent chunk", async () => {
    stream(content("hi"), { choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } }, { choices: [], usage: null }, stop, "[DONE]");
    const result = await new OpenAICompatibleAdapter(config).executeTask(input, () => {});
    expect(result.usage).toMatchObject({ inputTokens: 9, outputTokens: 2 });
  });
  it("leaves unreported counts null rather than zero", async () => {
    stream(content("hi"), stop, "[DONE]");
    const result = await new OpenAICompatibleAdapter(config).executeTask(input, () => {});
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null });
  });
  it("carries tokens out of a stream that breaks after reporting them", async () => {
    stream(content("hi"), { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } }, { choices: [], error: { message: "upstream gone" } });
    const error = await new OpenAICompatibleAdapter(config)
      .executeTask(input, () => {})
      .catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(usageFromError(error)).toMatchObject({ inputTokens: 20, outputTokens: 5 });
  });
  it("still rejects malformed counts instead of recording them", async () => {
    for (const usage of [{ prompt_tokens: -1 }, { completion_tokens: "999" }, { total_tokens: 1.5 }]) {
      stream(content("hi"), { choices: [], usage }, "[DONE]");
      await expect(new OpenAICompatibleAdapter(config).executeTask(input, () => {})).rejects.toThrow("unsupported output");
    }
  });
});

describe("Claude token accounting", () => {
  function adapterWith(query: unknown) {
    const adapter = new ClaudeAdapter({ ...config, type: "claude" });
    vi.spyOn(adapter as unknown as { sdk: () => Promise<unknown> }, "sdk").mockResolvedValue({ query });
    return adapter;
  }
  it("counts the cached prompt Anthropic reports outside input_tokens", async () => {
    const adapter = adapterWith(async function* () {
      yield {
        type: "result",
        subtype: "success",
        session_id: "s",
        result: "done",
        usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
      };
    });
    // input_tokens alone would record 5 tokens for a 1205-token prompt.
    expect((await adapter.executeTask(input, () => {})).usage).toEqual({
      inputTokens: 1205,
      outputTokens: 7,
      cachedInputTokens: 1000,
      costUsd: null,
    });
  });
  it("records the tokens a failed turn already spent", async () => {
    const adapter = adapterWith(async function* () {
      yield { type: "result", subtype: "error_max_turns", is_error: true, usage: { input_tokens: 300, output_tokens: 80 } };
    });
    const error = await adapter.executeTask(input, () => {}).catch((e) => e);
    expect(error.message).toContain("error_max_turns");
    expect(usageFromError(error)).toMatchObject({ inputTokens: 300, outputTokens: 80 });
  });
  it("keeps the tokens of a turn cancelled before its result", async () => {
    const controller = new AbortController();
    const adapter = adapterWith(async function* () {
      yield { type: "assistant", message: { usage: { input_tokens: 10, output_tokens: 4 }, content: [{ type: "text", text: "partial" }] } };
      yield { type: "assistant", message: { usage: { input_tokens: 2, output_tokens: 1 }, content: [] } };
      controller.abort();
    });
    const error = await adapter
      .executeTask({ ...input, signal: controller.signal }, () => {})
      .catch((e) => e);
    expect(usageFromError(error)).toMatchObject({ inputTokens: 12, outputTokens: 5 });
  });
});

describe("Codex token accounting", () => {
  it("reports cached input tokens as part of the prompt, never on top of it", async () => {
    const adapter = new CodexAdapter({ ...config, type: "codex" });
    const events = async function* () {
      yield { type: "thread.started", thread_id: "t" };
      yield { type: "item.completed", item: { type: "agent_message", text: "done" } };
      yield { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 90, cache_write_input_tokens: 0, output_tokens: 12, reasoning_output_tokens: 4 } };
    };
    vi.spyOn(adapter as unknown as { sdk: () => Promise<unknown> }, "sdk").mockResolvedValue({
      Codex: class {
        startThread() {
          return { runStreamed: async () => ({ events: events() }) };
        }
        resumeThread() {
          return { runStreamed: async () => ({ events: events() }) };
        }
      },
    });
    const result = await adapter.executeTask({ ...input, workspace: tmpdir(), agent: { id: "a", permissions: ["read"] } }, () => {});
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 12, cachedInputTokens: 90, costUsd: null });
  });
});

describe("configured token prices", () => {
  const provider = { id: "pid", type: "deepseek", model: "deepseek-flash" };
  it("prefers a price configured on the provider record", () => {
    expect(
      resolvePricing({ ...provider, pricing: { inputPerMillion: 1, outputPerMillion: 2 } } as never, {
        GHOSTGRID_PRICING: JSON.stringify({ pid: { inputPerMillion: 9, outputPerMillion: 9 } }),
      }),
    ).toEqual({ pricing: { inputPerMillion: 1, outputPerMillion: 2 }, source: "provider" });
  });
  it.each([
    ["pid", 1],
    ["deepseek:deepseek-flash", 2],
    ["deepseek-flash", 3],
    ["deepseek", 4],
    ["default", 5],
  ])("resolves the environment fallback keyed by %s", (key, inputPerMillion) => {
    const resolved = resolvePricing(provider as never, {
      GHOSTGRID_PRICING: JSON.stringify({ [key]: { inputPerMillion, outputPerMillion: 10 } }),
    });
    expect(resolved).toEqual({ pricing: { inputPerMillion, outputPerMillion: 10 }, source: "environment" });
  });
  it("matches the most specific key first", () => {
    const resolved = resolvePricing(provider as never, {
      GHOSTGRID_PRICING: JSON.stringify({
        default: { inputPerMillion: 5, outputPerMillion: 5 },
        deepseek: { inputPerMillion: 4, outputPerMillion: 4 },
        pid: { inputPerMillion: 1, outputPerMillion: 1 },
      }),
    });
    expect(resolved.pricing).toEqual({ inputPerMillion: 1, outputPerMillion: 1 });
  });
  it("reports an unusable configuration instead of silently pricing nothing", () => {
    expect(resolvePricing(provider as never, { GHOSTGRID_PRICING: "{not json" })).toMatchObject({
      pricing: null,
      source: "none",
      warning: expect.stringContaining("not valid JSON"),
    });
    expect(
      resolvePricing(provider as never, { GHOSTGRID_PRICING: JSON.stringify({ pid: { inputPerMillion: -1, outputPerMillion: 2 } }) }),
    ).toMatchObject({ pricing: null, source: "none", warning: expect.stringContaining("pid") });
  });
  it("prices nothing when nothing is configured", () => {
    expect(resolvePricing(provider as never, {})).toEqual({ pricing: null, source: "none" });
  });
});

describe("recorded usage", () => {
  async function setup(executeTask: unknown, registry?: unknown) {
    const dir = await mkdtemp(join(tmpdir(), "ghostgrid-usage-"));
    const store = new Store(":memory:");
    store.insert("projects", { id: "project", name: "Demo" });
    store.insert("providers", { id: "provider", type: "mock", concurrency: 2 });
    store.insert("agents", { id: "agent", projectId: "project", providerId: "provider", permissions: [] });
    const engine = new Engine(
      store,
      (registry ?? { get: () => ({ executeTask }) }) as never,
      { artifactsDir: dir, allowedWorkspaces: [], concurrency: 2 },
    );
    return {
      engine,
      store,
      cleanup: async () => {
        await engine.stop();
        store.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
  async function waitFor(fn: () => boolean) {
    for (let i = 0; i < 200; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Execution did not settle");
  }
  const submit = (engine: Engine, prompt = "hello") =>
    engine.submitTask({ projectId: "project", agentId: "agent", title: "T", prompt });

  it("estimates cost from GHOSTGRID_PRICING when the provider record carries no price", async () => {
    vi.stubEnv("GHOSTGRID_PRICING", JSON.stringify({ mock: { inputPerMillion: 1, outputPerMillion: 2 } }));
    const { engine, store, cleanup } = await setup(async () => ({
      output: "done",
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
    }));
    try {
      engine.start();
      const task = submit(engine);
      await waitFor(() => store.get("tasks", task.id)?.status === "completed");
      expect(store.list("usage_records")[0]).toMatchObject({
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        costUsd: null,
        estimatedCostUsd: 2,
        costSource: "estimated",
        pricingSource: "environment",
      });
      expect(store.usageSummary().totals).toMatchObject({ estimatedCostUsd: 2, unknownCostRequests: 0 });
    } finally {
      await cleanup();
    }
  });
  it("reports a misconfigured price once and keeps the cost honestly unknown", async () => {
    vi.stubEnv("GHOSTGRID_PRICING", "{broken");
    const { engine, store, cleanup } = await setup(async () => ({
      output: "done",
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    try {
      engine.start();
      const task = submit(engine);
      await waitFor(() => store.get("tasks", task.id)?.status === "completed");
      expect(store.list("usage_records")[0]).toMatchObject({ estimatedCostUsd: null, costSource: "unknown" });
      expect(store.events(0, task.id).map((event) => event.type)).toContain("usage.pricing.invalid");
      expect(store.usageSummary().totals).toMatchObject({ requests: 1, inputTokens: 10, unknownCostRequests: 1 });
    } finally {
      await cleanup();
    }
  });
  it("records the tokens a failed attempt already spent", async () => {
    const { engine, store, cleanup } = await setup(async () => {
      throw attachUsage(new ProviderError("upstream exploded"), {
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 100,
        costUsd: null,
      });
    });
    try {
      engine.start();
      const task = submit(engine);
      await waitFor(() => store.get("tasks", task.id)?.status === "failed");
      expect(store.list("usage_records")).toHaveLength(1);
      expect(store.list("usage_records")[0]).toMatchObject({
        taskId: task.id,
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 100,
        costSource: "unknown",
        partial: true,
      });
      expect(store.usageSummary().totals).toMatchObject({ requests: 1, inputTokens: 120, outputTokens: 30 });
    } finally {
      await cleanup();
    }
  });
  it("records nothing extra when a failure reports no tokens", async () => {
    const { engine, store, cleanup } = await setup(async () => {
      throw new ProviderError("no accounting available");
    });
    try {
      engine.start();
      const task = submit(engine);
      await waitFor(() => store.get("tasks", task.id)?.status === "failed");
      expect(store.list("usage_records")).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });
  it("leaves the mock provider's requests unmeasured rather than inventing numbers", async () => {
    // The live deployment's empty token counts came from this: a simulated provider
    // runs no model, so it reports nothing and is counted as unknown, not as free.
    const { engine, store, cleanup } = await setup(undefined, new ProviderRegistry());
    try {
      engine.start();
      const task = submit(engine);
      await waitFor(() => store.get("tasks", task.id)?.status === "completed");
      const record = store.list("usage_records")[0];
      expect(record).toMatchObject({ inputTokens: null, outputTokens: null, costUsd: null, estimatedCostUsd: null, costSource: "unknown" });
      expect(store.usageSummary().totals).toMatchObject({
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        unknownTokenRequests: 1,
        unknownCostRequests: 1,
      });
    } finally {
      await cleanup();
    }
  });
});
