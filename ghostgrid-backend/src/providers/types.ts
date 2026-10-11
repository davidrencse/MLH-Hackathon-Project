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
  inputTokens: number | null;
  outputTokens: number | null;
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
  constructor(
    message: string,
    public readonly transient = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
