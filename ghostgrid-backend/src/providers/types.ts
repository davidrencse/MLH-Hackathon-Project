export interface ProviderConfig {
  id: string;
  name: string;
  type: "mock" | "codex" | "claude" | "deepseek" | "openai-compatible" | "chatgpt-browser" | "claude-browser" | "deepseek-browser";
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  auth?: "bearer" | "none" | "header";
  apiKeyHeader?: string;
  headersEnv?: Record<string, string>;
  queryParameters?: Record<string, string>;
  concurrency: number;
  timeoutMs: number;
  supportsStreaming?: boolean;
  supportsModelDiscovery?: boolean;
  parameters?: { temperature?: number; maxTokens?: number };
  pricing?: { inputPerMillion: number; outputPerMillion: number };
}
export interface AgentConfig {
  id: string;
  permissions: ("read" | "write")[];
  workspace?: string;
}
export interface ExecutionInput {
  prompt: string;
  workspace?: string;
  sessionId?: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  signal: AbortSignal;
  agent: AgentConfig;
}
export interface Usage {
  /** Prompt tokens the vendor billed, including any served from its prompt cache. */
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * The part of inputTokens the vendor served from its prompt cache. Informational and
   * already counted inside inputTokens, so it is never added to it again.
   */
  cachedInputTokens?: number | null;
  /** Only a figure the vendor itself returned. Never an estimate. */
  costUsd?: number | null;
}
export interface ExecutionResult {
  output: string;
  sessionId?: string;
  usage?: Usage;
}
export interface Capabilities {
  inference: boolean;
  coding: boolean;
  streaming: boolean;
  resume: boolean;
  cancellation: boolean;
  tools: boolean;
  approvals: boolean;
}
export type Emit = (type: string, data: unknown) => void;
export interface ProviderAdapter {
  checkAvailability(): Promise<{
    available: boolean;
    message?: string;
    models?: string[];
  }>;
  executeTask(input: ExecutionInput, emit: Emit): Promise<ExecutionResult>;
  getCapabilities(): Capabilities;
}
export class ProviderError extends Error {
  /**
   * Tokens already spent when the attempt failed, when the adapter knows them. Set
   * through attachUsage() so it stays off serialized error payloads; the execution
   * engine records it rather than losing the spend. Non-enumerable, hence declared.
   */
  declare readonly usage?: Usage;
  constructor(
    message: string,
    public readonly transient = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
