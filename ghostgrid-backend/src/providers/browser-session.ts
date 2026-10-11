import { z } from "zod";
import { safeError } from "../security/index.js";
import { withSessionRecovery } from "./session-recovery.js";
import {
  ProviderError,
  type Emit,
  type ExecutionInput,
  type ProviderAdapter,
  type ProviderConfig,
} from "./types.js";

/**
 * Browser-hosted chat sessions: ChatGPT, Claude.ai and DeepSeek driven through their own
 * web interfaces instead of an API. The operator signs in themselves in a Chrome started
 * with `--remote-debugging-port`; this adapter attaches to that loopback DevTools endpoint,
 * opens one tab per Ghostgrid session, types the prompt with real input events and reads
 * the rendered assistant turn.
 *
 * Inference only: no tool calls, no code execution, no workspace access. These interfaces
 * report no token accounting, so usage stays null and is never invented. Cookies,
 * localStorage, the profile directory and network bodies are never read; only rendered DOM
 * text. The markup belongs to each vendor and can change without notice, so selector
 * failures are reported as failures rather than returning partial text.
 */
export type BrowserSiteId = "chatgpt" | "claude" | "deepseek";

interface SiteProfile {
  id: BrowserSiteId;
  label: string;
  /** First origin is used for new tabs; the rest are accepted for tabs already open. */
  origins: string[];
  newChatPath: string;
  conversationPath: string;
  /** In-page regular expression source capturing the conversation identifier from the path. */
  conversationPattern: string;
  composer: string;
  assistant: string;
  streaming: string;
  /** Query parameter carrying a model hint on a new conversation, when the site accepts one. */
  modelQuery?: string;
}

const SITES: Record<BrowserSiteId, SiteProfile> = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    origins: ["https://chatgpt.com", "https://chat.openai.com"],
    newChatPath: "/",
    conversationPath: "/c/",
    conversationPattern: "/c/([A-Za-z0-9-]{8,64})",
    composer: '#prompt-textarea, textarea[name="prompt-textarea"], div[contenteditable="true"]',
    assistant: '[data-message-author-role="assistant"]',
    streaming:
      'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]',
    modelQuery: "model",
  },
  claude: {
    id: "claude",
    label: "Claude",
    origins: ["https://claude.ai"],
    newChatPath: "/new",
    conversationPath: "/chat/",
    conversationPattern: "/chat/([A-Za-z0-9-]{8,64})",
    composer: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
    assistant: '[data-testid="assistant-message"], div.font-claude-message, div.font-claude-response',
    streaming: 'button[aria-label="Stop response"], button[aria-label="Stop generating"]',
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    origins: ["https://chat.deepseek.com"],
    newChatPath: "/",
    conversationPath: "/a/chat/s/",
    conversationPattern: "/chat/s/([A-Za-z0-9-]{8,64})",
    composer: '#chat-input, textarea[placeholder], div[contenteditable="true"]',
    assistant: "div.ds-markdown, div[class*='ds-markdown']",
    streaming: 'div[role="button"][aria-label*="top"], button[aria-label*="top"]',
  },
};

export const BROWSER_SITE_BY_TYPE: Record<string, BrowserSiteId> = {
  "chatgpt-browser": "chatgpt",
  "claude-browser": "claude",
  "deepseek-browser": "deepseek",
};

export const BROWSER_PROVIDER_TYPES = Object.keys(BROWSER_SITE_BY_TYPE);

const DEFAULT_ENDPOINT = "http://127.0.0.1:9222";
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];
const POLL_INTERVAL_MS = 600;
const MIN_POLL_INTERVAL_MS = 50;
const STABLE_POLLS = 3;
const MAX_OUTPUT = 8_000_000;

const versionSchema = z.object({
  Browser: z.string().max(200).optional(),
});
const targetSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().max(50).optional(),
  url: z.string().max(4000).optional(),
  webSocketDebuggerUrl: z.string().max(2000).optional(),
});
const targetsSchema = z.array(targetSchema).max(1000);
const cdpMessageSchema = z.object({
  id: z.number().int().nonnegative().safe().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().max(2000).optional() }).optional(),
});
const evaluateSchema = z.object({
  result: z.object({ value: z.unknown().optional() }).optional(),
  exceptionDetails: z.unknown().optional(),
});
const stateSchema = z.object({
  ready: z.boolean(),
  path: z.string().max(4000),
  composer: z.boolean(),
  focused: z.boolean(),
  turns: z.number().int().nonnegative().safe(),
  text: z.string().max(MAX_OUTPUT),
  streaming: z.boolean(),
  conversation: z.string().max(200).nullable(),
});
type PageState = z.infer<typeof stateSchema>;

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new ProviderError("Browser returned unsupported output");
  return result.data;
}

/** Bound DevTools HTTP responses before JSON allocation. */
async function readJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError("Browser output limit exceeded");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("Browser returned no response body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ProviderError("Browser output limit exceeded");
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    } catch {
      throw new ProviderError("Browser returned invalid JSON");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function sleep(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** Minimal DevTools Protocol client over the loopback debugging socket. */
class DevToolsSession {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  private failure?: ProviderError;
  private constructor(private readonly socket: WebSocket) {}

  static async connect(url: string, signal: AbortSignal): Promise<DevToolsSession> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ProviderError("Browser returned an unsupported DevTools target");
    }
    if (parsed.protocol !== "ws:" || !LOOPBACK.includes(parsed.hostname))
      throw new ProviderError("DevTools targets must be loopback ws:// endpoints");
    signal.throwIfAborted();
    const socket = new WebSocket(parsed.toString());
    const session = new DevToolsSession(socket);
    socket.addEventListener("message", (event) => session.receive(event.data));
    socket.addEventListener("error", () =>
      session.fail(new ProviderError("Browser DevTools connection failed", true)),
    );
    socket.addEventListener("close", () =>
      session.fail(new ProviderError("Browser DevTools connection closed", true)),
    );
    let onAbort: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new ProviderError("Browser DevTools connection failed", true)),
          { once: true },
        );
        socket.addEventListener(
          "close",
          () => reject(new ProviderError("Browser DevTools connection closed", true)),
          { once: true },
        );
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    } catch (error) {
      session.close();
      throw error;
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
    return session;
  }

  private receive(data: unknown) {
    if (typeof data !== "string" || data.length > 16_000_000) {
      this.fail(new ProviderError("Browser output limit exceeded"));
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      this.fail(new ProviderError("Browser returned invalid JSON"));
      return;
    }
    const message = cdpMessageSchema.safeParse(payload);
    if (!message.success || message.data.id === undefined) return; // Protocol events are unused.
    const waiting = this.pending.get(message.data.id);
    if (!waiting) return;
    this.pending.delete(message.data.id);
    if (message.data.error) waiting.reject(new ProviderError("Browser rejected a DevTools command"));
    else waiting.resolve(message.data.result);
  }

  private fail(error: ProviderError) {
    this.failure ??= error;
    for (const [id, waiting] of this.pending) {
      this.pending.delete(id);
      waiting.reject(error);
    }
  }

  async send(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (this.failure) throw this.failure;
    if (this.pending.size > 64) throw new ProviderError("Too many pending DevTools commands");
    const id = this.nextId++;
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        onAbort = () => {
          this.pending.delete(id);
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          this.socket.send(JSON.stringify({ id, method, params }));
        } catch {
          this.pending.delete(id);
          reject(new ProviderError("Browser DevTools connection failed", true));
        }
      });
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  /** Arguments cross as one JSON string literal, so page code is never built from input. */
  async evaluate<T>(source: string, args: unknown, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    const payload = parsePayload(
      evaluateSchema,
      await this.send(
        "Runtime.evaluate",
        {
          expression: `(${source})(${JSON.stringify(JSON.stringify(args))})`,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
        signal,
      ),
    );
    if (payload.exceptionDetails) throw new ProviderError("Chat page script failed");
    return parsePayload(schema, payload.result?.value);
  }

  close() {
    this.fail(new ProviderError("Browser DevTools connection closed", true));
    try {
      this.socket.close();
    } catch {
      /* Closing a failed socket is not an execution error. */
    }
  }
}

/** Reads page state only: it focuses the composer but never submits or mutates content. */
const STATE_SCRIPT = `(raw) => {
  const site = JSON.parse(raw);
  const composer = document.querySelector(site.composer);
  if (composer && site.focus && document.activeElement !== composer) composer.focus();
  const nodes = Array.from(document.querySelectorAll(site.assistant));
  const latest = nodes.length > site.turns ? nodes[nodes.length - 1] : null;
  const match = location.pathname.match(new RegExp(site.conversationPattern));
  return {
    ready: document.readyState === 'complete',
    path: location.pathname,
    composer: !!composer,
    focused: !!composer && document.activeElement === composer,
    turns: nodes.length,
    text: latest ? String(latest.innerText || '').slice(0, ${MAX_OUTPUT}) : '',
    streaming: !!document.querySelector(site.streaming),
    conversation: match ? match[1] : null,
  };
}`;

const STOP_SCRIPT = `(raw) => {
  const site = JSON.parse(raw);
  const button = document.querySelector(site.streaming);
  if (button) button.click();
  return { stopped: !!button };
}`;

export class BrowserSessionAdapter implements ProviderAdapter {
  private readonly site: SiteProfile;
  constructor(
    private readonly config: ProviderConfig,
    site: BrowserSiteId,
  ) {
    this.site = SITES[site];
  }

  getCapabilities() {
    return {
      inference: true,
      coding: false,
      streaming: true,
      resume: true,
      cancellation: true,
      tools: false,
      approvals: false,
    };
  }

  /** Short task timeouts poll faster so a turn is observed within its own budget. */
  private get pollIntervalMs() {
    return Math.min(POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.floor(this.config.timeoutMs / 50)));
  }

  private pageArgs(turns = 0, focus = false) {
    return {
      composer: this.site.composer,
      assistant: this.site.assistant,
      streaming: this.site.streaming,
      conversationPattern: this.site.conversationPattern,
      turns,
      focus,
    };
  }

  private endpoint() {
    const url = new URL((this.config.baseUrl ?? DEFAULT_ENDPOINT).replace(/\/$/, ""));
    if (
      url.protocol !== "http:" ||
      !LOOPBACK.includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new ProviderError(
        "Configure the Chrome DevTools endpoint as loopback HTTP, for example http://127.0.0.1:9222",
      );
    return url.origin;
  }

  private async devtools(path: string, method: "GET" | "PUT", signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.endpoint()}${path}`, { method, signal, redirect: "error" });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new ProviderError(
        `Chrome DevTools endpoint unreachable at ${this.endpoint()}; start Chrome with --remote-debugging-port and sign in to ${this.site.label} (${safeError(error).message})`,
        true,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ProviderError(`Chrome DevTools HTTP ${response.status}`, response.status >= 500);
    }
    return readJson(response, 4_000_000, signal);
  }

  private conversationUrl(id: string, origin = this.site.origins[0]) {
    return new URL(`${this.site.conversationPath}${encodeURIComponent(id)}`, origin).toString();
  }

  private newChatUrl() {
    const url = new URL(this.site.newChatPath, this.site.origins[0]);
    // Some sites accept a model slug as a hint; an unknown slug may be ignored by the interface.
    if (this.config.model && this.site.modelQuery) url.searchParams.set(this.site.modelQuery, this.config.model);
    return url.toString();
  }

  private siteTabs(targets: z.infer<typeof targetsSchema>) {
    return targets.filter(
      (candidate) =>
        candidate.type === "page" &&
        candidate.webSocketDebuggerUrl &&
        this.site.origins.some((origin) => (candidate.url ?? "").startsWith(origin)),
    );
  }

  /**
   * One tab per session: an existing tab holding the conversation is reused, otherwise a
   * tab is opened for this session alone. A browser that refuses `/json/new` falls back to
   * an already open tab of this site, which then serializes every session through it.
   */
  private async target(sessionId: string | undefined, signal: AbortSignal) {
    const tabs = this.siteTabs(parsePayload(targetsSchema, await this.devtools("/json/list", "GET", signal)));
    const held = sessionId
      ? tabs.find((candidate) => (candidate.url ?? "").includes(`${this.site.conversationPath}${sessionId}`))
      : undefined;
    if (held) return { target: held, opened: false };
    const url = sessionId ? this.conversationUrl(sessionId) : this.newChatUrl();
    try {
      const created = parsePayload(
        targetSchema,
        await this.devtools(`/json/new?${encodeURIComponent(url)}`, "PUT", signal),
      );
      if (created.webSocketDebuggerUrl) return { target: created, opened: true };
    } catch (error) {
      if (signal.aborted) throw error;
    }
    if (tabs[0]) return { target: tabs[0], opened: false };
    throw new ProviderError(
      `Open ${this.site.origins[0]} in the connected Chrome and sign in before running tasks`,
    );
  }

  /** Wait for a signed-in composer, and treat a dropped conversation path as a missing session. */
  private async settle(session: DevToolsSession, conversation: string | undefined, signal: AbortSignal) {
    const deadline = Date.now() + Math.min(this.config.timeoutMs, 120_000);
    let state: PageState | undefined;
    try {
      while (Date.now() < deadline) {
        state = await session.evaluate(STATE_SCRIPT, this.pageArgs(0, true), stateSchema, signal);
        if (state.ready && state.composer) break;
        await sleep(this.pollIntervalMs, signal);
      }
    } catch (error) {
      // A ready page without a composer needs sign-in guidance. Preserve explicit
      // cancellation and transport errors instead of relabeling them as sign-in failures.
      if (!(signal.reason?.name === "TimeoutError" && state?.ready && !state.composer)) throw error;
    }
    if (!state?.composer)
      throw new ProviderError(
        `${this.site.label} composer was not found in the connected browser; sign in to ${this.site.label} in that Chrome profile and open a chat`,
      );
    if (conversation && !state.path.includes(`${this.site.conversationPath}${conversation}`))
      throw new ProviderError(`session not found in the connected ${this.site.label} browser tab`);
    return state;
  }

  /** Real input events: site composers are rich editors that ignore assigned values. */
  private async type(session: DevToolsSession, prompt: string, signal: AbortSignal) {
    const focused = await session.evaluate(STATE_SCRIPT, this.pageArgs(0, true), stateSchema, signal);
    if (!focused.focused) throw new ProviderError(`${this.site.label} composer could not be focused`);
    await session.send("Input.insertText", { text: prompt }, signal);
    for (const type of ["keyDown", "keyUp"] as const)
      await session.send(
        "Input.dispatchKeyEvent",
        {
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
          ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
        },
        signal,
      );
  }

  async checkAvailability(): ReturnType<ProviderAdapter["checkAvailability"]> {
    const signal = AbortSignal.timeout(Math.min(this.config.timeoutMs, 30_000));
    try {
      const version = parsePayload(versionSchema, await this.devtools("/json/version", "GET", signal));
      const tabs = this.siteTabs(parsePayload(targetsSchema, await this.devtools("/json/list", "GET", signal)));
      return {
        available: true,
        message: `${version.Browser ?? "Chrome"} DevTools endpoint reachable with ${tabs.length} ${this.site.label} tab(s); sign-in, model selection and page structure are verified on execution`,
      };
    } catch (error) {
      return { available: false, message: safeError(error).message };
    }
  }

  async executeTask(input: ExecutionInput, emit: Emit) {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(this.config.timeoutMs)]);
    return withSessionRecovery({ ...input, signal }, emit, (attempt, notify) =>
      this.executeAttempt(attempt, notify),
    );
  }

  private async executeAttempt(input: ExecutionInput, emit: Emit) {
    input.signal.throwIfAborted();
    if (input.prompt.length > 1_000_000) throw new ProviderError("Prompt exceeds the browser composer limit");
    const { target, opened } = await this.target(input.sessionId, input.signal);
    const session = await DevToolsSession.connect(target.webSocketDebuggerUrl!, input.signal);
    try {
      await session.send("Runtime.enable", {}, input.signal);
      await session.send("Page.enable", {}, input.signal);
      if (!opened) {
        const origin = new URL(target.url ?? this.site.origins[0]).origin;
        const wanted = input.sessionId ? this.conversationUrl(input.sessionId, origin) : this.newChatUrl();
        const current = target.url ?? "";
        const needsNavigation = input.sessionId
          ? !current.includes(`${this.site.conversationPath}${input.sessionId}`)
          : current.includes(this.site.conversationPath);
        if (needsNavigation) await session.send("Page.navigate", { url: wanted }, input.signal);
      }
      const before = (await this.settle(session, input.sessionId, input.signal)).turns;
      await this.type(session, input.prompt, input.signal);

      let output = "";
      let conversation = input.sessionId;
      let stable = 0;
      let started = false;
      let announced = false;
      const deadline = Date.now() + this.config.timeoutMs;
      try {
        while (Date.now() < deadline) {
          await sleep(this.pollIntervalMs, input.signal);
          const state = await session.evaluate(
            STATE_SCRIPT,
            this.pageArgs(before),
            stateSchema,
            input.signal,
          );
          if (state.conversation && state.conversation !== conversation) {
            conversation = state.conversation;
            if (!announced) {
              announced = true;
              emit("agent.connected", { sessionId: conversation, site: this.site.id });
            }
          }
          if (!state.composer) throw new ProviderError(`${this.site.label} page changed while the turn was running`);
          if (state.text.length > MAX_OUTPUT) throw new ProviderError("Browser output limit exceeded");
          if (state.text.startsWith(output) && state.text.length > output.length) {
            const delta = state.text.slice(output.length);
            output = state.text;
            emit("agent.output", { text: delta });
          } else if (state.text !== output) {
            // The rendered turn was rewritten (for example a regenerate); report the whole text.
            output = state.text;
            emit("agent.output", { text: output, replaced: true });
          }
          started ||= state.streaming || state.turns > before;
          stable = state.streaming || !started || !output ? 0 : stable + 1;
          if (stable >= STABLE_POLLS)
            return {
              output,
              ...(conversation ? { sessionId: conversation } : {}),
              usage: { inputTokens: null, outputTokens: null },
            };
        }
      } catch (error) {
        if (input.signal.aborted)
          await session
            .evaluate(STOP_SCRIPT, this.pageArgs(), z.object({ stopped: z.boolean() }), AbortSignal.timeout(2000))
            .catch(() => undefined);
        throw error;
      }
      throw new ProviderError(
        `${this.site.label} did not finish the turn before the configured timeout`,
      );
    } finally {
      session.close();
    }
  }
}
