import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_PROVIDER_TYPES,
  BROWSER_SITE_BY_TYPE,
  BrowserSessionAdapter,
  type BrowserSiteId,
} from "../src/providers/browser-session.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { isMissingSession } from "../src/providers/session-recovery.js";
import type { ExecutionInput, ProviderConfig } from "../src/providers/types.js";

const config: ProviderConfig = {
  id: "p",
  name: "browser",
  type: "chatgpt-browser",
  auth: "none",
  concurrency: 1,
  timeoutMs: 2500,
};
const input: ExecutionInput = {
  prompt: "Hello from GhostGrid",
  messages: [],
  agent: { id: "a", permissions: ["read"] },
  signal: new AbortController().signal,
};
interface Command {
  method: string;
  params: Record<string, any>;
}
const page = (overrides: Record<string, unknown> = {}) => ({
  ready: true,
  path: "/",
  composer: true,
  focused: true,
  turns: 0,
  text: "",
  streaming: false,
  conversation: null,
  ...overrides,
});

/** Fake Chrome: DevTools HTTP discovery plus a scripted DevTools WebSocket target. */
function stubBrowser(options: {
  targets?: Record<string, unknown>[];
  created?: Record<string, unknown> | null;
  states?: Record<string, unknown>[];
  focusStates?: Record<string, unknown>[];
}) {
  const commands: Command[] = [];
  const requests: string[] = [];
  const states = [...(options.states ?? [])];
  const focusStates = [...(options.focusStates ?? [])];
  let currentPath = options.targets?.[0]?.url ? new URL(String(options.targets[0].url)).pathname : "/";
  let lastState: Record<string, unknown> | undefined;
  let lastFocusState: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    requests.push(`${init.method ?? "GET"} ${url}`);
    const path = new URL(url).pathname;
    if (path === "/json/version") return new Response(JSON.stringify({ Browser: "Chrome/142" }));
    if (path === "/json/list") return new Response(JSON.stringify(options.targets ?? []));
    if (path === "/json/new") {
      currentPath = new URL(decodeURIComponent(new URL(url).search.slice(1))).pathname;
      if (options.created === null) return new Response("refused", { status: 405 });
      return new Response(
        JSON.stringify(
          options.created ?? {
            id: "new-tab",
            type: "page",
            url: "https://chatgpt.com/",
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/new-tab",
          },
        ),
      );
    }
    throw new Error(`unexpected DevTools request ${path}`);
  });
  class FakeSocket {
    private readonly listeners = new Map<string, ((event: any) => void)[]>();
    constructor(readonly url: string) {
      queueMicrotask(() => this.dispatch("open", {}));
    }
    addEventListener(type: string, handler: (event: any) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
    }
    removeEventListener() {}
    private dispatch(type: string, event: any) {
      for (const handler of this.listeners.get(type) ?? []) handler(event);
    }
    send(raw: string) {
      const { id, method, params } = JSON.parse(raw);
      commands.push({ method, params });
      let result: unknown = {};
      if (method === "Page.navigate") currentPath = new URL(params.url).pathname;
      if (method === "Runtime.evaluate") {
        // evaluate passes its arguments as a JSON-encoded JSON string literal.
        const argument = params.expression.slice(params.expression.lastIndexOf(")(") + 2, -1);
        const focusing = JSON.parse(JSON.parse(argument)).focus === true;
        const stopping = /stopped/.test(params.expression);
        if (focusing) lastFocusState = focusStates.shift() ?? lastFocusState ?? page({ path: currentPath });
        else lastState = states.shift() ?? lastState ?? page({ turns: 1, text: "done", path: currentPath });
        const value = stopping ? { stopped: true } : focusing ? lastFocusState : lastState;
        result = { result: { value } };
      }
      queueMicrotask(() => this.dispatch("message", { data: JSON.stringify({ id, result }) }));
    }
    close() {
      this.dispatch("close", {});
    }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  return { commands, requests };
}
const evaluations = (commands: Command[]) => commands.filter((c) => c.method === "Runtime.evaluate");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser-hosted chat sessions", () => {
  it("registers one adapter per site", () => {
    const registry = new ProviderRegistry();
    for (const type of BROWSER_PROVIDER_TYPES)
      expect(registry.get({ ...config, type: type as ProviderConfig["type"] })).toBeInstanceOf(
        BrowserSessionAdapter,
      );
    expect(BROWSER_SITE_BY_TYPE).toEqual({
      "chatgpt-browser": "chatgpt",
      "claude-browser": "claude",
      "deepseek-browser": "deepseek",
    });
  });

  it("reports the DevTools endpoint and the site's open tabs without inference", async () => {
    const { requests } = stubBrowser({
      targets: [
        { id: "1", type: "page", url: "https://chatgpt.com/c/abc", webSocketDebuggerUrl: "ws://127.0.0.1:9222/1" },
        { id: "2", type: "page", url: "https://example.invalid/", webSocketDebuggerUrl: "ws://127.0.0.1:9222/2" },
      ],
    });
    const result = await new BrowserSessionAdapter(config, "chatgpt").checkAvailability();
    expect(result.available).toBe(true);
    expect(result.message).toContain("1 ChatGPT tab(s)");
    expect(requests).toEqual([
      "GET http://127.0.0.1:9222/json/version",
      "GET http://127.0.0.1:9222/json/list",
    ]);
  });

  it.each(["https://127.0.0.1:9222", "http://chatgpt.com", "http://127.0.0.1:9222/devtools"])(
    "refuses a DevTools endpoint that is not loopback HTTP (%s)",
    async (baseUrl) => {
      stubBrowser({});
      const result = await new BrowserSessionAdapter({ ...config, baseUrl }, "chatgpt").checkAvailability();
      expect(result).toEqual({
        available: false,
        message: "Configure the Chrome DevTools endpoint as loopback HTTP, for example http://127.0.0.1:9222",
      });
    },
  );

  it("streams the rendered turn, records the conversation id and reports no token usage", async () => {
    const { commands, requests } = stubBrowser({
      states: [
        page({ streaming: true, turns: 1, text: "Hi", conversation: "conv-12345678" }),
        page({ streaming: true, turns: 1, text: "Hi there", conversation: "conv-12345678" }),
        page({ turns: 1, text: "Hi there.", conversation: "conv-12345678" }),
        page({ turns: 1, text: "Hi there.", conversation: "conv-12345678" }),
        page({ turns: 1, text: "Hi there.", conversation: "conv-12345678" }),
      ],
    });
    const emit = vi.fn();
    const result = await new BrowserSessionAdapter(config, "chatgpt").executeTask(input, emit);
    expect(result).toEqual({
      output: "Hi there.",
      sessionId: "conv-12345678",
      usage: { inputTokens: null, outputTokens: null },
    });
    expect(emit.mock.calls).toEqual([
      ["agent.connected", { sessionId: "conv-12345678", site: "chatgpt" }],
      ["agent.output", { text: "Hi" }],
      ["agent.output", { text: " there" }],
      ["agent.output", { text: "." }],
    ]);
    // A new session opens its own tab; the prompt crosses as input, never as page code.
    expect(requests).toContain(`PUT http://127.0.0.1:9222/json/new?${encodeURIComponent("https://chatgpt.com/")}`);
    expect(commands.find((c) => c.method === "Input.insertText")?.params.text).toBe(input.prompt);
    expect(commands.filter((c) => c.method === "Input.dispatchKeyEvent").map((c) => c.params.type)).toEqual([
      "keyDown",
      "keyUp",
    ]);
    for (const command of evaluations(commands)) expect(command.params.expression).not.toContain(input.prompt);
  });

  it.each([
    ["claude", "https://claude.ai/new", "/chat/"],
    ["deepseek", "https://chat.deepseek.com/", "/a/chat/s/"],
  ])("opens %s in its own interface", async (site, newChat, conversationPath) => {
    const { requests } = stubBrowser({ states: [page({ turns: 1, text: "ok" })] });
    await new BrowserSessionAdapter(
      { ...config, type: `${site}-browser` as ProviderConfig["type"] },
      site as BrowserSiteId,
    ).executeTask(input, vi.fn());
    expect(requests).toContain(`PUT http://127.0.0.1:9222/json/new?${encodeURIComponent(newChat)}`);
    const resumed = stubBrowser({ states: [page({ turns: 1, text: "ok", path: `${conversationPath}kept-1234`, conversation: "kept-1234" })] });
    await new BrowserSessionAdapter(
      { ...config, type: `${site}-browser` as ProviderConfig["type"] },
      site as BrowserSiteId,
    ).executeTask({ ...input, sessionId: "kept-1234" }, vi.fn());
    expect(resumed.requests.some((request) => request.includes(encodeURIComponent(`${conversationPath}kept-1234`)))).toBe(
      true,
    );
  });

  it("reuses the tab that already holds the conversation instead of opening another", async () => {
    const { commands, requests } = stubBrowser({
      targets: [
        {
          id: "held",
          type: "page",
          url: "https://chatgpt.com/c/conv-12345678",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/held",
        },
      ],
      focusStates: [page({ path: "/c/conv-12345678", conversation: "conv-12345678" })],
      states: [page({ turns: 1, text: "resumed", path: "/c/conv-12345678", conversation: "conv-12345678" })],
    });
    const result = await new BrowserSessionAdapter(config, "chatgpt").executeTask(
      { ...input, sessionId: "conv-12345678" },
      vi.fn(),
    );
    expect(result.output).toBe("resumed");
    expect(requests.some((request) => request.includes("/json/new"))).toBe(false);
    expect(commands.some((command) => command.method === "Page.navigate")).toBe(false);
  });

  it("recovers a dropped conversation path into a new conversation with saved history", async () => {
    const { commands } = stubBrowser({ focusStates: [page({ path: "/" })],
      states: [page({ turns: 1, text: "restored", conversation: "fresh-12345678" })] });
    const emit = vi.fn();
    const result = await new BrowserSessionAdapter(config, "chatgpt").executeTask({
      ...input, sessionId: "gone-12345678", messages: [{ role: "user", content: "Keep the earlier design" }],
    }, emit);
    expect(result.sessionId).toBe("fresh-12345678");
    expect(result.output).toBe("restored");
    expect(emit).toHaveBeenCalledWith("agent.session.recovered", { reason: "native_session_missing", restoredMessages: 1 });
    expect(commands.find((command) => command.method === "Input.insertText")?.params.text).toContain("Keep the earlier design");
    expect(isMissingSession(new Error("session not found in the connected ChatGPT browser tab"))).toBe(true);
  });

  it("fails when nobody is signed in, rather than returning empty output", async () => {
    stubBrowser({ focusStates: Array.from({ length: 60 }, () => page({ composer: false, focused: false })) });
    await expect(new BrowserSessionAdapter(config, "chatgpt").executeTask(input, vi.fn())).rejects.toThrow(
      "sign in to ChatGPT in that Chrome profile",
    );
  });

  it("stops the streaming turn when the task is cancelled", async () => {
    const { commands } = stubBrowser({
      states: [page({ streaming: true, turns: 1, text: "partial", conversation: "conv-12345678" })],
    });
    const controller = new AbortController();
    const emit = vi.fn((type: string) => {
      if (type === "agent.output") controller.abort(new Error("cancelled"));
    });
    await expect(
      new BrowserSessionAdapter(config, "chatgpt").executeTask({ ...input, signal: controller.signal }, emit),
    ).rejects.toThrow("cancelled");
    expect(evaluations(commands).some((command) => /stopped/.test(command.params.expression))).toBe(true);
  });

  it("rejects an unreachable DevTools endpoint as transient", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const adapter = new BrowserSessionAdapter(config, "chatgpt");
    const availability = await adapter.checkAvailability();
    expect(availability.available).toBe(false);
    expect(availability.message).toContain("start Chrome with --remote-debugging-port");
    await expect(adapter.executeTask(input, vi.fn())).rejects.toMatchObject({ transient: true });
  });

  it("declares inference-only capabilities", () => {
    expect(new BrowserSessionAdapter(config, "chatgpt").getCapabilities()).toEqual({
      inference: true,
      coding: false,
      streaming: true,
      resume: true,
      cancellation: true,
      tools: false,
      approvals: false,
    });
  });
});
