import { z } from "zod";
import { registerSecret, safeError } from "../security/index.js";
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderConfig,
  type ExecutionInput,
  type Emit,
  type Usage,
} from "./types.js";
import { attachUsage, completeFromTotal, emptyUsage, mergeUsage, normalizeUsage } from "./usage.js";
const tokenCount = z.number().int().nonnegative().safe().nullable().optional();
const cachedDetails = z.object({ cached_tokens: tokenCount }).nullable().optional();
const usageSchema = z.object({
  prompt_tokens: tokenCount,
  completion_tokens: tokenCount,
  // Gateways that report only a total, or that name the halves the way the Responses API does.
  total_tokens: tokenCount,
  input_tokens: tokenCount,
  output_tokens: tokenCount,
  // Cached prompt tokens are a subset of prompt_tokens here, never an addition to it.
  prompt_tokens_details: cachedDetails,
  input_tokens_details: cachedDetails,
});
type VendorUsage = z.infer<typeof usageSchema>;
const completionSchema = z.object({
  error: z.unknown().optional(),
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.unknown()).nullable().optional() }).optional(),
    delta: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.unknown()).nullable().optional() }).optional(),
    finish_reason: z.string().nullable().optional(),
  })).max(1).optional(),
  usage: usageSchema.nullable().optional(),
  // Groq reports the turn's tokens here on its final streamed chunk, alongside (or
  // instead of) the standard usage chunk that stream_options asks for.
  x_groq: z.object({ usage: usageSchema.nullable().optional() }).nullable().optional(),
});
/** Reads whichever token fields a vendor actually sent; silence stays null, never zero. */
function vendorUsage(payload: { usage?: VendorUsage | null; x_groq?: { usage?: VendorUsage | null } | null }): Usage | null {
  const raw = payload.usage ?? payload.x_groq?.usage;
  if (!raw) return null;
  const usage = normalizeUsage({
    inputTokens: raw.prompt_tokens ?? raw.input_tokens,
    outputTokens: raw.completion_tokens ?? raw.output_tokens,
    cachedInputTokens: raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens,
  });
  return completeFromTotal(usage, raw.total_tokens);
}
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(200) })).max(10000) });
function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new ProviderError("Provider returned unsupported output");
  return result.data;
}
/** Abort reads even when a compatible transport ignores fetch's signal. */
async function readWithSignal(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([reader.read(), aborted]);
    signal.throwIfAborted();
    return result;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
/** Bound bytes while reading, before JSON allocation and validation. */
async function readJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError("Provider output limit exceeded");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("Provider returned no response body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await readWithSignal(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ProviderError("Provider output limit exceeded");
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    } catch {
      throw new ProviderError("Provider returned invalid JSON");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class OpenAICompatibleAdapter implements ProviderAdapter {
  constructor(private readonly config: ProviderConfig) {}
  getCapabilities() {
    return {
      inference: true,
      coding: false,
      streaming: this.config.supportsStreaming !== false,
      resume: false,
      cancellation: true,
      tools: false,
      approvals: false,
    };
  }
  private headers() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const setHeader = (name: string, value: string) => {
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        /[\r\n]/.test(value) ||
        /^(host|content-type|content-length|transfer-encoding|connection)$/i.test(
          name,
        )
      )
        throw new ProviderError("Invalid provider header");
      headers[name] = value;
      registerSecret(value);
    };
    for (const [header, reference] of Object.entries(
      this.config.headersEnv ?? {},
    )) {
      const value = process.env[reference];
      if (!value)
        throw new ProviderError(
          `Missing header environment variable: ${reference}`,
        );
      setHeader(header, value);
    }
    if (this.config.auth !== "none") {
      const name =
        this.config.apiKeyEnv ??
        (this.config.type === "deepseek"
          ? "DEEPSEEK_API_KEY"
          : "OPENAI_API_KEY");
      const key = process.env[name];
      if (!key)
        throw new ProviderError(
          `Missing credential environment variable: ${name}`,
        );
      registerSecret(key);
      if (this.config.auth === "header") {
        if (!this.config.apiKeyHeader)
          throw new ProviderError(
            "Header authentication requires apiKeyHeader",
          );
        setHeader(this.config.apiKeyHeader, key);
      } else setHeader("Authorization", `Bearer ${key}`);
    }
    return headers;
  }
  private url(path: string) {
    const base =
      this.config.baseUrl ??
      (this.config.type === "deepseek"
        ? "https://api.deepseek.com"
        : "https://api.openai.com/v1");
    const url = new URL(`${base.replace(/\/$/, "")}/${path}`);
    const baseUrl = new URL(base);
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash ||
      !(baseUrl.protocol === "https:" || (baseUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname))))
      throw new ProviderError("Use HTTPS or loopback HTTP without URL credentials, query or fragment");
    for (const [key, value] of Object.entries(
      this.config.queryParameters ?? {},
    )) {
      if (/(key|token|secret|password|credential|authorization)/i.test(key))
        throw new ProviderError(
          "Credentials must use environment-referenced headers, not query parameters",
        );
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
  private async request(path: string, init: RequestInit, signal: AbortSignal) {
    const response = await fetch(this.url(path), {
      ...init,
      headers: this.headers(),
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(
        `Provider HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    return response;
  }
  async checkAvailability(): ReturnType<ProviderAdapter["checkAvailability"]> {
    try {
      if (this.config.supportsModelDiscovery === false) {
        this.headers();
        this.url("chat/completions");
        return {
          available: !!this.config.model,
          message:
            "Model discovery disabled; actual model availability is verified on execution",
        };
      }
      const signal = AbortSignal.timeout(this.config.timeoutMs);
      const response = await this.request("models", {}, signal);
      const payload = parsePayload(modelsSchema, await readJson(response, 2_000_000, signal));
      const models = payload.data.map((m) => m.id);
      if (!this.config.model)
        return {
          available: false,
          message: "Configure a model identifier",
          models,
        };
      return {
        available: models.includes(this.config.model),
        models,
        ...(!models.includes(this.config.model)
          ? { message: "Configured model was not returned by /models" }
          : {}),
      };
    } catch (e) {
      return {
        available: false,
        message: safeError(e).message,
      };
    }
  }
  async executeTask(input: ExecutionInput, emit: Emit) {
    input.signal.throwIfAborted();
    if (!this.config.model)
      throw new ProviderError("Configure a model identifier");
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.config.timeoutMs),
    ]);
    // DeepSeek model IDs are validated against its live catalogue. Generic endpoints may omit /models.
    if (
      this.config.type === "deepseek" &&
      this.config.supportsModelDiscovery !== false
    ) {
      const response = await this.request("models", {}, signal);
      const models = parsePayload(modelsSchema, await readJson(response, 2_000_000, signal));
      if (!models.data.some((m) => m.id === this.config.model))
        throw new ProviderError(
          "Configured DeepSeek model was not returned by /models",
        );
    }
    const response = await this.request(
      "chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            ...input.messages,
            { role: "user", content: input.prompt },
          ],
          stream: this.config.supportsStreaming !== false,
          // Every OpenAI-compatible stream withholds token counts unless this is asked
          // for: without it no chunk carries usage and the request is recorded with
          // unknown tokens. Requested for all streaming endpoints, not only DeepSeek,
          // which is why Groq-style providers reported nothing at all.
          ...(this.config.supportsStreaming !== false
            ? { stream_options: { include_usage: true } }
            : {}),
          ...(this.config.parameters?.temperature !== undefined
            ? { temperature: this.config.parameters.temperature }
            : {}),
          ...(this.config.parameters?.maxTokens !== undefined
            ? { max_tokens: this.config.parameters.maxTokens }
            : {}),
        }),
      },
      signal,
    );
    if (this.config.supportsStreaming === false) {
      const payload = parsePayload(completionSchema, await readJson(response, 32_000_000, signal));
      const choice = payload.choices?.[0];
      if (payload.error || !choice || (choice.message?.tool_calls?.length ?? 0) > 0)
        throw new ProviderError("Provider returned unsupported output");
      if (choice.finish_reason && choice.finish_reason !== "stop")
        throw attachUsage(
          new ProviderError(`Provider stopped with ${choice.finish_reason}`),
          vendorUsage(payload),
        );
      const output = choice.message?.content;
      if (typeof output !== "string")
        throw new ProviderError("Provider returned unsupported output");
      if (output.length > 8_000_000)
        throw new ProviderError("Provider output limit exceeded");
      emit("agent.output", { text: output });
      return { output, usage: vendorUsage(payload) ?? emptyUsage() };
    }
    if (!response.body)
      throw new ProviderError("Provider returned no response stream");
    let output = "",
      buffer = "",
      done = false,
      receivedContent = false,
      receivedBytes = 0;
    let usage: Usage = emptyUsage();
    const decoder = new TextDecoder();
    const consume = (frame: string) => {
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      if (data === "[DONE]") {
        done = true;
        return;
      }
      let json: unknown;
      try { json = JSON.parse(data); }
      catch { throw new ProviderError("Provider returned invalid JSON"); }
      const chunk = parsePayload(completionSchema, json);
      // Counts can arrive before an error or a nonstop finish, and split across the
      // final chunks: a later chunk that omits a field must not erase a reported one.
      usage = mergeUsage(usage, vendorUsage(chunk));
      if (chunk.error)
        throw new ProviderError("Provider returned a streaming error");
      for (const choice of chunk.choices ?? []) {
        if ((choice.delta?.tool_calls?.length ?? 0) > 0)
          throw new ProviderError(
            "Tool execution is unsupported by this inference adapter",
          );
        if (typeof choice.delta?.content === "string") {
          receivedContent = true;
          output += choice.delta.content;
          if (output.length > 8_000_000)
            throw new ProviderError("Provider output limit exceeded");
          emit("agent.output", { text: choice.delta.content });
        }
        if (choice.finish_reason && choice.finish_reason !== "stop")
          throw new ProviderError(
            `Provider stopped with ${choice.finish_reason}`,
          );
      }
    };
    const reader = response.body.getReader();
    // Tokens a cancelled or broken stream already reported were still spent, so they
    // leave on the failure instead of vanishing.
    try {
      try {
        while (true) {
          signal.throwIfAborted();
          const { value: bytes, done: ended } = await readWithSignal(reader, signal);
          if (ended) break;
          receivedBytes += bytes.byteLength;
          if (receivedBytes > 32_000_000)
            throw new ProviderError("Provider output limit exceeded");
          buffer = (buffer + decoder.decode(bytes, { stream: true })).replace(
            /\r\n/g,
            "\n",
          );
          if (buffer.length > 4_000_000 || output.length > 8_000_000)
            throw new ProviderError("Provider output limit exceeded");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            consume(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            if (done) break;
          }
          // The protocol marker completes the response even if the server keeps
          // the HTTP connection alive. Breaking also cancels the response body.
          if (done) break;
        }
      } finally {
        // Cleanup must not hide the original failure or invalidate completion.
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (!done) {
        buffer += decoder.decode();
        if (buffer.trim()) consume(buffer);
      }
      if (!done)
        throw new ProviderError(
          "Provider stream ended before its completion marker",
        );
      if (!receivedContent)
        throw new ProviderError("Provider returned no text result");
    } catch (error) {
      throw attachUsage(error, usage);
    }
    return { output, usage };
  }
}
