import { codingEnvironment } from "./environment.js";
import { withSessionRecovery } from "./session-recovery.js";
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderConfig,
  type ExecutionInput,
  type Emit,
  type Usage,
} from "./types.js";
interface Item {
  type: string;
  text?: string;
  command?: string;
  changes?: unknown;
}
interface Event {
  type: string;
  thread_id?: string;
  item?: Item;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { message: string };
  message?: string;
}
interface Thread {
  runStreamed(
    prompt: string,
    options: { signal: AbortSignal },
  ): Promise<{ events: AsyncIterable<Event> }>;
}
interface Client {
  startThread(options: Record<string, unknown>): Thread;
  resumeThread(id: string, options: Record<string, unknown>): Thread;
}
interface SDK {
  Codex: new (options?: Record<string, unknown>) => Client;
}
export class CodexAdapter implements ProviderAdapter {
  constructor(private readonly config: ProviderConfig) {}
  getCapabilities() {
    return {
      inference: true,
      coding: true,
      streaming: true,
      resume: true,
      cancellation: true,
      tools: true,
      approvals: false,
    };
  }
  private async sdk(): Promise<SDK> {
    const packageName = "@openai/codex-sdk";
    try {
      return (await import(packageName)) as SDK;
    } catch {
      throw new ProviderError(
        "Install @openai/codex-sdk and authenticate using codex login",
      );
    }
  }
  async checkAvailability() {
    try {
      if (this.config.apiKeyEnv && !process.env[this.config.apiKeyEnv])
        throw new ProviderError(
          `Missing credential environment variable: ${this.config.apiKeyEnv}`,
        );
      await this.sdk();
      return {
        available: true,
        message:
          "SDK installed; authentication and sandbox support are verified on execution",
      };
    } catch (e) {
      return { available: false, message: (e as Error).message };
    }
  }
  async executeTask(input: ExecutionInput, emit: Emit) {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(this.config.timeoutMs)]);
    return withSessionRecovery({ ...input, signal }, emit, (attempt, notify) => this.executeAttempt(attempt, notify));
  }
  private async executeAttempt(input: ExecutionInput, emit: Emit) {
    input.signal.throwIfAborted();
    if (!input.workspace)
      throw new ProviderError(
        "Codex requires an explicit allowlisted workspace",
      );
    if (!input.agent.permissions.includes("read"))
      throw new ProviderError("Codex requires read capability");
    const { Codex } = await this.sdk();
    input.signal.throwIfAborted();
    const apiKey = this.config.apiKeyEnv
      ? process.env[this.config.apiKeyEnv]
      : undefined;
    if (this.config.apiKeyEnv && !apiKey)
      throw new ProviderError(
        `Missing credential environment variable: ${this.config.apiKeyEnv}`,
      );
    const client = new Codex({
      env: codingEnvironment(apiKey ? [] : ["CODEX_API_KEY", "OPENAI_API_KEY"]),
      configOverrides: ["mcp_servers={}"],
      ...(apiKey ? { apiKey } : {}),
      ...(this.config.baseUrl ? { baseUrl: this.config.baseUrl } : {}),
    });
    const options = {
      ...(this.config.model ? { model: this.config.model } : {}),
      workingDirectory: input.workspace,
      sandboxMode: input.agent.permissions.includes("write")
        ? "workspace-write"
        : "read-only",
      approvalPolicy: "untrusted",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    };
    const thread = input.sessionId
      ? client.resumeThread(input.sessionId, options)
      : client.startThread(options);
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.config.timeoutMs),
    ]);
    const { events } = await thread.runStreamed(input.prompt, { signal });
    let output = "",
      sessionId = input.sessionId,
      completed = false;
    let usage: Usage = { inputTokens: null, outputTokens: null };
    for await (const event of events) {
      if (event.type === "thread.started") {
        sessionId = event.thread_id;
        emit("agent.connected", { sessionId });
      }
      if (event.type === "turn.completed") {
        completed = true;
        if (event.usage)
          usage = {
            inputTokens: event.usage.input_tokens,
            outputTokens: event.usage.output_tokens,
          };
      }
      if (event.type === "turn.failed" || event.type === "error")
        throw new ProviderError(
          event.error?.message ?? event.message ?? "Codex execution failed",
        );
      if (event.item) {
        if (
          event.item.type === "agent_message" &&
          event.type === "item.completed"
        ) {
          output += event.item.text ?? "";
          emit("agent.output", { text: event.item.text ?? "" });
        }
        if (event.item.type === "command_execution")
          emit(
            event.type === "item.completed"
              ? "agent.tool.completed"
              : "agent.tool.started",
            event.item,
          );
        if (
          event.item.type === "file_change" &&
          event.type === "item.completed"
        )
          emit("agent.file.changed", { changes: event.item.changes });
      }
    }
    signal.throwIfAborted();
    if (!completed)
      throw new ProviderError("Codex ended without a completed turn");
    return { output, ...(sessionId ? { sessionId } : {}), usage };
  }
}
