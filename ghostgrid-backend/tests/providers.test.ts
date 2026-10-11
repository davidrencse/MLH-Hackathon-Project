import type { RequestListener } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeAdapter } from "../src/providers/claude.js";
import { codingEnvironment } from "../src/providers/environment.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { OpenAICompatibleAdapter } from "../src/providers/openai-compatible.js";
import { redact } from "../src/security/index.js";
import type { ExecutionInput, ProviderConfig } from "../src/providers/types.js";
const config: ProviderConfig = {
  id: "p",
  name: "test",
  type: "mock",
  concurrency: 1,
  timeoutMs: 1000,
};
const input: ExecutionInput = {
  prompt: "Hello",
  messages: [],
  agent: { id: "a", permissions: ["read"] },
  signal: new AbortController().signal,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function endpoint(handler: RequestListener) {
  vi.stubGlobal("fetch", async () => {
    const chunks: string[] = [];
    const res = {
      statusCode: 200,
      setHeader() {},
      write(text: string) {
        chunks.push(text);
      },
      end(text = "") {
        chunks.push(text);
      },
    };
    handler({} as never, res as never);
    return new Response(chunks.join(""), { status: res.statusCode });
  });
  return "https://fixture.invalid/v1";
}
describe("providers", () => {
  it.each([
    ["Groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY"],
    ["DeepSeek", "https://api.deepseek.com", "DEEPSEEK_API_KEY"],
  ])("checks %s credentials through model discovery without inference", async (_name, baseUrl, apiKeyEnv) => {
    vi.stubEnv(apiKeyEnv, "offline-connectivity-test-secret");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "discovered-model" }] })));
    vi.stubGlobal("fetch", fetch);
    const result = await new OpenAICompatibleAdapter({ ...config, type: "openai-compatible", baseUrl, apiKeyEnv }).checkAvailability();
    expect(result.models).toEqual(["discovered-model"]);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/models`);
    expect(options.method ?? "GET").toBe("GET");
    expect(options.body).toBeUndefined();
    expect(options.redirect).toBe("error");
    expect(options.headers).toMatchObject({ Authorization: "Bearer offline-connectivity-test-secret" });
  });
  it("redacts credential-bearing model-discovery errors", async () => {
    vi.stubEnv("GG_DISCOVERY_AUTH", "offline-discovery-secret");
    vi.stubGlobal("fetch", async () => { throw new Error("transport failed with offline-discovery-secret"); });
    const result = await new OpenAICompatibleAdapter({ ...config, apiKeyEnv: "GG_DISCOVERY_AUTH" }).checkAvailability();
    expect(result).toEqual({ available: false, message: "transport failed with [REDACTED]" });
  });
  it.each([true, false])(
    "bounds model discovery response bytes (declared length: %s)",
    async (declared) => {
      const cancel = vi.fn();
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                if (!declared) controller.enqueue(new Uint8Array(2_000_001));
              },
              cancel,
            }),
            { headers: declared ? { "content-length": "2000001" } : {} },
          ),
      );
      const result = await new OpenAICompatibleAdapter({
        ...config,
        type: "openai-compatible",
        model: "test",
        auth: "none",
      }).checkAvailability();
      expect(result).toMatchObject({
        available: false,
        message: "Provider output limit exceeded",
      });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { choices: [{ delta: { content: { unsafe: true } } }] },
    { choices: [], usage: { prompt_tokens: -1 } },
    { choices: [], usage: { completion_tokens: "999" } },
    null,
  ])(
    "rejects malformed streaming payloads before emitting them (%#)",
    async (payload) => {
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`),
      );
      const emit = vi.fn();
      await expect(
        new OpenAICompatibleAdapter({
          ...config,
          type: "openai-compatible",
          model: "test",
          auth: "none",
        }).executeTask(input, emit),
      ).rejects.toThrow("unsupported output");
      expect(emit).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed JSON without exposing its contents", async () => {
    vi.stubGlobal("fetch", async () => new Response("{secret-payload"));
    await expect(
      new OpenAICompatibleAdapter({
        ...config,
        model: "test",
        auth: "none",
        supportsStreaming: false,
      }).executeTask(input, () => {}),
    ).rejects.toThrow(/^Provider returned invalid JSON$/);
  });
  it("registers arbitrary credential references when an adapter is used directly", async () => {
    vi.stubEnv("GG_ARBITRARY_AUTH", "arbitrary-adapter-secret-value");
    const adapter = new OpenAICompatibleAdapter({
      ...config,
      type: "openai-compatible",
      model: "test",
      apiKeyEnv: "GG_ARBITRARY_AUTH",
      supportsModelDiscovery: false,
    });
    expect((await adapter.checkAvailability()).available).toBe(true);
    expect(redact("arbitrary-adapter-secret-value", {})).toBe("[REDACTED]");
  });
  it.each([
    "http://example.test",
    "file:///tmp",
    "https://user:password@example.test",
    "https://example.test?token=raw",
  ])("rejects unsafe base URLs inside the adapter: %s", async (baseUrl) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      new OpenAICompatibleAdapter({
        ...config,
        model: "test",
        auth: "none",
        baseUrl,
      }).executeTask(input, () => {}),
    ).rejects.toThrow(/HTTPS or loopback/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("aborts in-flight HTTP work at the provider timeout", async () => {
    vi.stubGlobal(
      "fetch",
      async (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = options.signal!;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    await expect(
      new OpenAICompatibleAdapter({
        ...config,
        type: "openai-compatible",
        model: "test",
        auth: "none",
        timeoutMs: 10,
      }).executeTask(input, () => {}),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
  it.each([
    [{ unexpected: "object" }, "unsupported output"],
    ["x".repeat(8_000_001), "output limit"],
  ])("rejects invalid nonstreaming content (%#)", async (content, error) => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content }, finish_reason: "stop" }],
          }),
        ),
    );
    const emit = vi.fn();
    await expect(
      new OpenAICompatibleAdapter({
        ...config,
        type: "openai-compatible",
        model: "test",
        auth: "none",
        supportsStreaming: false,
      }).executeTask(input, emit),
    ).rejects.toThrow(error as string);
    expect(emit).not.toHaveBeenCalled();
  });
  it.each([undefined, null])("rejects a missing nonstreaming text result (%s)", async (content) => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] })));
    await expect(new OpenAICompatibleAdapter({ ...config, model: "test", auth: "none", supportsStreaming: false }).executeTask(input, () => {})).rejects.toThrow("unsupported output");
  });
  it.each([true, false])("accepts empty tool-call arrays from compatible servers (stream: %s)", async (stream) => {
    const payload = { choices: [stream ? { delta: { content: "text", tool_calls: [] }, finish_reason: "stop" } : { message: { content: "text", tool_calls: [] }, finish_reason: "stop" }] };
    vi.stubGlobal("fetch", async () => new Response(stream ? `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n` : JSON.stringify(payload)));
    expect((await new OpenAICompatibleAdapter({ ...config, model: "test", auth: "none", supportsStreaming: stream }).executeTask(input, () => {})).output).toBe("text");
  });
  it.each(["data: [DONE]\n\n", 'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'])("rejects streams that never provide text", async (stream) => {
    vi.stubGlobal("fetch", async () => new Response(stream));
    await expect(new OpenAICompatibleAdapter({ ...config, model: "test", auth: "none" }).executeTask(input, () => {})).rejects.toThrow("no text result");
  });
  it("validates endpoint configuration when discovery is disabled", async () => {
    const result = await new OpenAICompatibleAdapter({ ...config, model: "test", auth: "none", baseUrl: "http://remote.invalid", supportsModelDiscovery: false }).checkAvailability();
    expect(result.available).toBe(false);
    expect(result.message).toContain("HTTPS or loopback");
  });
  it("registers and executes explicit mock", async () => {
    const adapter = new ProviderRegistry().get(config);
    expect((await adapter.checkAvailability()).available).toBe(true);
    const result = await adapter.executeTask(input, () => {});
    expect(result.output).toContain("Hello");
    expect(result.usage?.inputTokens).toBeNull();
  });
  it("does not claim inference can execute coding tools", () => {
    expect(
      new OpenAICompatibleAdapter({
        ...config,
        type: "deepseek",
      }).getCapabilities(),
    ).toMatchObject({ coding: false, tools: false, resume: false });
  });
  it("rejects missing credentials without network request", async () => {
    const adapter = new OpenAICompatibleAdapter({
      ...config,
      type: "deepseek",
      apiKeyEnv: "GHOSTGRID_TEST_MISSING_KEY",
      model: "test",
    });
    const status = await adapter.checkAvailability();
    expect(status.available).toBe(false);
    expect(status.message).toContain("Missing credential");
  });
  it("normalizes streaming output and unknown usage", async () => {
    const baseUrl = await endpoint((_req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.write('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n');
      res.end(
        'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    });
    const adapter = new OpenAICompatibleAdapter({
      ...config,
      type: "openai-compatible",
      baseUrl,
      model: "test",
      auth: "none",
    });
    const events: unknown[] = [];
    const result = await adapter.executeTask(input, (type, data) =>
      events.push({ type, data }),
    );
    expect(result.output).toBe("hello");
    expect(result.usage?.outputTokens).toBeNull();
    expect(events).toHaveLength(2);
  });
  it("fails truncated streams", async () => {
    const baseUrl = await endpoint((_req, res) =>
      res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    );
    await expect(
      new OpenAICompatibleAdapter({
        ...config,
        type: "openai-compatible",
        baseUrl,
        model: "test",
        auth: "none",
      }).executeTask(input, () => {}),
    ).rejects.toThrow("completion marker");
  });
  it("finishes and cancels keepalive streams at the completion marker", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"complete"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"ignored"}}]}\n\n',
                ),
              );
              // Deliberately keep the transport open after protocol completion.
            },
            cancel,
          }),
        ),
    );
    const result = await new OpenAICompatibleAdapter({
      ...config,
      type: "openai-compatible",
      model: "test",
      auth: "none",
    }).executeTask(input, () => {});
    expect(result.output).toBe("complete");
    expect(cancel).toHaveBeenCalledOnce();
  }, 1000);
  it("handles UTF-8 and CRLF split across stream chunks", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"héllo"}}]}\r\n\r\ndata: [DONE]\r\n\r\n',
    );
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
              controller.close();
            },
          }),
        ),
    );
    expect(
      (
        await new OpenAICompatibleAdapter({
          ...config,
          type: "openai-compatible",
          model: "test",
          auth: "none",
        }).executeTask(input, () => {})
      ).output,
    ).toBe("héllo");
  });
  it("preserves completed output when response cleanup rejects", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
                ),
              );
            },
            cancel() {
              throw new Error("cleanup failed");
            },
          }),
        ),
    );
    expect(
      (
        await new OpenAICompatibleAdapter({
          ...config,
          type: "openai-compatible",
          model: "test",
          auth: "none",
        }).executeTask(input, () => {})
      ).output,
    ).toBe("ok");
  });
  it("honors disabled DeepSeek discovery during execution", async () => {
    const fetch = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await new OpenAICompatibleAdapter({
      ...config,
      type: "deepseek",
      model: "test",
      auth: "none",
      supportsStreaming: false,
      supportsModelDiscovery: false,
    }).executeTask(input, () => {});
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toContain("chat/completions");
  });
  it("rejects an oversized final output chunk before emitting it", async () => {
    const fragment = "x".repeat(3_000_000);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < 3; i++)
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: fragment } }] })}\n\n`,
                  ),
                );
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
        ),
    );
    const emit = vi.fn();
    await expect(
      new OpenAICompatibleAdapter({
        ...config,
        type: "openai-compatible",
        model: "test",
        auth: "none",
      }).executeTask(input, emit),
    ).rejects.toThrow("output limit");
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it.each(["mock", "codex", "claude", "openai-compatible"] as const)(
    "rejects already cancelled %s tasks before starting provider work",
    async (type) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const controller = new AbortController();
      controller.abort(new Error("cancelled before execution"));
      await expect(
        new ProviderRegistry()
          .get({ ...config, type, model: "test", auth: "none" })
          .executeTask({ ...input, signal: controller.signal }, () => {}),
      ).rejects.toThrow("cancelled before execution");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("marks rate limits transient and hides response bodies", async () => {
    const baseUrl = await endpoint((_req, res) => {
      res.statusCode = 429;
      res.end("secret-provider-key");
    });
    await expect(
      new OpenAICompatibleAdapter({
        ...config,
        type: "openai-compatible",
        baseUrl,
        model: "test",
        auth: "none",
      }).executeTask(input, () => {}),
    ).rejects.toMatchObject({ message: "Provider HTTP 429", transient: true });
  });
  it("honors cancellation", async () => {
    const controller = new AbortController();
    const promise = new ProviderRegistry()
      .get(config)
      .executeTask(
        { ...input, prompt: "[delay:1000]", signal: controller.signal },
        () => {},
      );
    controller.abort();
    await expect(promise).rejects.toThrow();
  });
  it("supports nonstreaming servers without model discovery", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          }),
        ),
    );
    const adapter = new OpenAICompatibleAdapter({
      ...config,
      type: "openai-compatible",
      model: "local",
      auth: "none",
      supportsStreaming: false,
      supportsModelDiscovery: false,
    });
    expect((await adapter.checkAvailability()).available).toBe(true);
    expect((await adapter.executeTask(input, () => {})).usage).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
    });
    expect(adapter.getCapabilities().streaming).toBe(false);
  });
  it("skips DeepSeek model discovery when disabled", async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const adapter = new OpenAICompatibleAdapter({
      ...config,
      type: "deepseek",
      model: "configured",
      auth: "none",
      supportsModelDiscovery: false,
      supportsStreaming: false,
    });
    expect((await adapter.checkAvailability()).available).toBe(true);
    expect((await adapter.executeTask(input, () => {})).output).toBe("hello");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });
  it("validates DeepSeek against current model discovery", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ data: [{ id: "another-model" }] })),
    );
    const adapter = new OpenAICompatibleAdapter({
      ...config,
      type: "deepseek",
      model: "invalid",
      auth: "none",
    });
    await expect(adapter.executeTask(input, () => {})).rejects.toThrow(
      "not returned by /models",
    );
  });
  it("rejects coding execution without an explicit workspace", async () => {
    const adapter = new ProviderRegistry().get({ ...config, type: "codex" });
    await expect(adapter.executeTask(input, () => {})).rejects.toThrow(
      "explicit allowlisted workspace",
    );
  });

  it("supports environment-referenced header auth and version query parameters", async () => {
    vi.stubEnv("GG_FIXTURE_KEY", "fixture-key-value");
    vi.stubEnv("GG_FIXTURE_METADATA", "metadata-value");
    const requests: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      requests.push({
        url,
        headers: options.headers as Record<string, string>,
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        }),
      );
    });
    const adapter = new OpenAICompatibleAdapter({
      ...config,
      type: "openai-compatible",
      baseUrl: "https://example.test/openai/deployments/agent",
      model: "agent",
      auth: "header",
      apiKeyHeader: "api-key",
      apiKeyEnv: "GG_FIXTURE_KEY",
      headersEnv: { "x-project": "GG_FIXTURE_METADATA" },
      queryParameters: { "api-version": "2024-10-21" },
      supportsStreaming: false,
    });
    await adapter.executeTask(input, () => {});
    expect(requests[0].headers["api-key"]).toBe("fixture-key-value");
    expect(requests[0].headers["x-project"]).toBe("metadata-value");
    expect(requests[0].url).toBe(
      "https://example.test/openai/deployments/agent/chat/completions?api-version=2024-10-21",
    );
  });
  it("rejects header injection and credentials in query parameters", async () => {
    vi.stubEnv("GG_BAD_HEADER", "bad\r\nInjected: value");
    const adapter = new OpenAICompatibleAdapter({
      ...config,
      type: "openai-compatible",
      model: "test",
      auth: "none",
      headersEnv: { "x-meta": "GG_BAD_HEADER" },
    });
    await expect(adapter.executeTask(input, () => {})).rejects.toThrow(
      "Invalid provider header",
    );
    const query = new OpenAICompatibleAdapter({
      ...config,
      type: "openai-compatible",
      model: "test",
      auth: "none",
      queryParameters: { apiKey: "plain-key" },
    });
    await expect(query.executeTask(input, () => {})).rejects.toThrow(
      "Credentials must use",
    );
  });
  it("strips unrelated credential variables from coding subprocesses", () => {
    expect(
      codingEnvironment(["ANTHROPIC_API_KEY"], {
        HOME: "/home/operator",
        PATH: "/bin",
        ANTHROPIC_API_KEY: "allowed",
        DEEPSEEK_API_KEY: "unrelated",
        GHOSTGRID_API_TOKEN: "private",
      }),
    ).toEqual({
      HOME: "/home/operator",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "allowed",
    });
  });
});

describe("Claude SDK integration contract", () => {
  it("resumes SDK sessions, configures gateways, and avoids cumulative cost double counting", async () => {
    let options: Record<string, unknown> | undefined;
    const adapter = new ClaudeAdapter({
      ...config,
      type: "claude",
      baseUrl: "https://gateway.example.test/anthropic",
    });
    const sdk = {
      query: async function* (request: { options: Record<string, unknown> }) {
        options = request.options;
        yield { type: "system", subtype: "init", session_id: "native-session" };
        yield {
          type: "result",
          subtype: "success",
          session_id: "native-session",
          result: "Reviewed",
          total_cost_usd: 14.5,
          usage: { input_tokens: 20, output_tokens: 5 },
        };
      },
    };
    vi.spyOn(
      adapter as unknown as { sdk: () => Promise<typeof sdk> },
      "sdk",
    ).mockResolvedValue(sdk);
    const events: unknown[] = [];
    const result = await adapter.executeTask(
      {
        ...input,
        agent: { id: "a", permissions: [] },
        sessionId: "native-session",
      },
      (type, data) => events.push({ type, data }),
    );
    expect(options?.resume).toBe("native-session");
    expect((options?.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe(
      "https://gateway.example.test/anthropic",
    );
    expect(options?.permissionMode).toBe("default");
    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      costUsd: null,
    });
    expect(events).toContainEqual({
      type: "agent.connected",
      data: { sessionId: "native-session" },
    });
  });
});

describe("bounded provider transports", () => {
  it("bounds streaming bytes even when every frame is an ignored comment", async () => {
    const cancelled = vi.fn();
    const frame = new TextEncoder().encode(`: ${"x".repeat(1_000_000)}\n\n`);
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(frame); },
      cancel: cancelled,
    })));
    await expect(new OpenAICompatibleAdapter({ ...config, model: "test", auth: "none", timeoutMs: 5000 }).executeTask(input, () => {})).rejects.toThrow("Provider output limit exceeded");
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it.each([true, false])("cancels a stalled response reader (stream: %s)", async (stream) => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({
      start() { queueMicrotask(() => controller.abort(new Error("operator cancellation"))); },
      cancel: cancelled,
    })));
    const adapter = new OpenAICompatibleAdapter({ ...config, model: "test", auth: "none", supportsStreaming: stream });
    await expect(adapter.executeTask({ ...input, signal: controller.signal }, () => {})).rejects.toThrow("operator cancellation");
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("times out stalled model discovery even when fetch ignores its signal", async () => {
    const cancelled = vi.fn();
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ cancel: cancelled })));
    const result = await new OpenAICompatibleAdapter({ ...config, model: "test", auth: "none", timeoutMs: 20 }).checkAvailability();
    expect(result.available).toBe(false);
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it.each([true, false])("rejects ambiguous multiple completions (stream: %s)", async (stream) => {
    const choice = stream ? { delta: { content: "different" } } : { message: { content: "different" } };
    const payload = JSON.stringify({ choices: [choice, choice] });
    vi.stubGlobal("fetch", async () => new Response(stream ? `data: ${payload}\n\ndata: [DONE]\n\n` : payload));
    await expect(new OpenAICompatibleAdapter({ ...config, model: "test", auth: "none", supportsStreaming: stream }).executeTask(input, () => {})).rejects.toThrow("unsupported output");
  });
});
