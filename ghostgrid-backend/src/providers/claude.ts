import { realpath, readFile, lstat, opendir } from "node:fs/promises";
import { resolve, relative, join, isAbsolute } from "node:path";
import { codingEnvironment } from "./environment.js";
import { isMissingSession, withSessionRecovery } from "./session-recovery.js";
import { safePath } from "../security/index.js";
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderConfig,
  type ExecutionInput,
  type Emit,
  type ExecutionResult,
} from "./types.js";
interface Message {
  type: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  is_error?: boolean;
  errors?: string[];
  usage?: { input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
  message?: {
    content: {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }[];
  };
}
interface SDK {
  getSessionInfo?(id: string, options: { dir?: string }): Promise<unknown | undefined>;
  query(input: {
    prompt: string;
    options: Record<string, unknown>;
  }): AsyncIterable<Message>;
}
export type ToolDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };
const sensitive =
  /^(?:\.git|\.env.*|\.(?:aws|ssh|codex|claude|azure|kube|docker|config|npmrc|netrc|pypirc)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|\.?(?:credentials|secrets?|tokens?|passwords?)(?:[._-].*)?|.*\.(?:pem|key|p12|pfx))$/i;
/** Native recursive tools cannot filter results after a read. Verify every
 * descendant first and require a narrower subtree if any entry is unsafe. */
async function safeSearchTree(
  path: string,
  signal: AbortSignal,
): Promise<boolean> {
  const pending = [{ path, depth: 0 }];
  let entries = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const current = pending.pop()!;
    if (++entries > 10_000 || current.depth > 64) return false;
    const stat = await lstat(current.path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      return false;
    if (!stat.isDirectory()) continue;
    for await (const child of await opendir(current.path)) {
      signal.throwIfAborted();
      const name = child.name;
      if (entries + pending.length >= 10_000) return false;
      if (sensitive.test(name)) return false;
      pending.push({
        path: join(current.path, name),
        depth: current.depth + 1,
      });
    }
  }
  return true;
}
/** Enforced both by PreToolUse (including SDK auto-allowed reads) and permission callback. */
export async function claudeToolPolicy(
  input: ExecutionInput,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolDecision> {
  const writing = tool === "Write" || tool === "Edit";
  if (!["Read", "Glob", "Grep", "Write", "Edit"].includes(tool))
    return { behavior: "deny", message: "Tool is outside agent capabilities" };
  if (!input.agent.permissions.includes(writing ? "write" : "read"))
    return { behavior: "deny", message: "Agent capability is not granted" };
  if (!input.workspace)
    return {
      behavior: "deny",
      message: "A workspace is required for file access",
    };
  try {
    const root = await realpath(input.workspace);
    const candidate =
      args.file_path ?? args.path ?? (writing ? undefined : root);
    if (typeof candidate !== "string" || !candidate)
      return { behavior: "deny", message: "An explicit file path is required" };
    const requested = relative(root, resolve(root, candidate));
    const path = safePath(root, requested);
    const actual = relative(root, path);
    if (
      [...requested.split(/[\/]/), ...actual.split(/[\/]/)].some((part) =>
        sensitive.test(part),
      )
    )
      return {
        behavior: "deny",
        message: "Sensitive files and agent settings are restricted",
      };
    if (tool === "Glob" || tool === "Grep") {
      if (tool === "Glob") {
        const pattern = args.pattern;
        if (
          typeof pattern !== "string" ||
          isAbsolute(pattern) ||
          pattern.includes("..") ||
          /[{}\[\]()\0]/.test(pattern)
        )
          return {
            behavior: "deny",
            message:
              "Glob patterns must remain relative to the selected search directory",
          };
      }
      if (!(await safeSearchTree(path, input.signal)))
        return {
          behavior: "deny",
          message:
            "Recursive search contains sensitive files, symlinks, or exceeds its scan budget; choose an explicit safe file or narrower directory",
        };
    }
    if (writing) {
      const gitMarker = resolve(root, ".git");
      if (
        !(await lstat(gitMarker)).isFile() ||
        !(await readFile(gitMarker, "utf8")).startsWith("gitdir: ")
      )
        return {
          behavior: "deny",
          message: "Writes require an isolated Git worktree",
        };
      // Execution engine creates detached worktrees; never edit the caller’s configured source workspace.
      if (
        input.agent.workspace &&
        (await realpath(input.agent.workspace)) === root
      )
        return {
          behavior: "deny",
          message: "Writes to the source workspace are forbidden",
        };
    }
    return {
      behavior: "allow",
      updatedInput: {
        ...args,
        [tool === "Read" || writing ? "file_path" : "path"]: path,
      },
    };
  } catch {
    return {
      behavior: "deny",
      message: "Path cannot be safely resolved inside an isolated workspace",
    };
  }
}
export class ClaudeAdapter implements ProviderAdapter {
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
    const packageName = "@anthropic-ai/claude-agent-sdk";
    try {
      return (await import(packageName)) as SDK;
    } catch {
      throw new ProviderError(
        "Install @anthropic-ai/claude-agent-sdk and configure supported Claude authentication",
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
        message: "SDK installed; credentials are verified on execution",
      };
    } catch (e) {
      return { available: false, message: (e as Error).message };
    }
  }
  async executeTask(
    input: ExecutionInput,
    emit: Emit,
  ): Promise<ExecutionResult> {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(this.config.timeoutMs)]);
    return withSessionRecovery({ ...input, signal }, emit, (attempt, notify) => this.executeAttempt(attempt, notify));
  }
  private async executeAttempt(
    input: ExecutionInput,
    emit: Emit,
  ): Promise<ExecutionResult> {
    input.signal.throwIfAborted();
    if (input.agent.permissions.includes("read") && !input.workspace)
      throw new ProviderError(
        "Claude file access requires an explicit workspace",
      );
    const sdk = await this.sdk();
    const { query } = sdk;
    input.signal.throwIfAborted();
    if (input.sessionId && sdk.getSessionInfo &&
      !(await sdk.getSessionInfo(input.sessionId, { dir: input.workspace })))
      throw new ProviderError("Native session not found");
    input.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.config.timeoutMs),
    ]);
    const abort = () => controller.abort(signal.reason);
    const tools = input.agent.permissions.includes("read")
      ? ["Read", "Glob", "Grep"]
      : [];
    if (input.agent.permissions.includes("write")) tools.push("Edit", "Write");
    const env: Record<string, string | undefined> = codingEnvironment(
      this.config.apiKeyEnv
        ? []
        : ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
    );
    if (this.config.apiKeyEnv) {
      if (!process.env[this.config.apiKeyEnv])
        throw new ProviderError(
          `Missing credential environment variable: ${this.config.apiKeyEnv}`,
        );
      env.ANTHROPIC_API_KEY = process.env[this.config.apiKeyEnv];
    }
    if (this.config.baseUrl) {
      const baseUrl = new URL(this.config.baseUrl);
      if (
        baseUrl.username ||
        baseUrl.password ||
        baseUrl.search ||
        baseUrl.hash ||
        !(
          baseUrl.protocol === "https:" ||
          (baseUrl.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname))
        )
      )
        throw new ProviderError(
          "Use HTTPS or loopback HTTP without URL credentials, query or fragment",
        );
      env.ANTHROPIC_BASE_URL = this.config.baseUrl;
    }
    const canUseTool = async (tool: string, args: Record<string, unknown>) => {
      const decision = await claudeToolPolicy(input, tool, args);
      if (decision.behavior === "deny")
        emit("agent.approval.required", {
          tool,
          reason: decision.message,
          resolution: "denied",
          liveApprovalSupported: false,
        });
      return decision;
    };
    let result: ExecutionResult | undefined;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      for await (const message of query({
        prompt: input.prompt,
        options: {
          cwd: input.workspace,
          ...(this.config.model ? { model: this.config.model } : {}),
          ...(input.sessionId ? { resume: input.sessionId } : {}),
          abortController: controller,
          permissionMode: "default",
          tools,
          allowedTools: [],
          settingSources: [],
          mcpServers: {},
          disallowedTools: [
            "Bash",
            "Agent",
            "Task",
            "WebFetch",
            "WebSearch",
            "NotebookEdit",
          ],
          canUseTool,
          env,
          maxTurns: 20,
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async (hook: {
                    tool_name: string;
                    tool_input: Record<string, unknown>;
                  }) => {
                    const decision = await canUseTool(
                      hook.tool_name,
                      hook.tool_input,
                    );
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision:
                          decision.behavior === "allow" ? "allow" : "deny",
                        permissionDecisionReason:
                          decision.behavior === "deny"
                            ? decision.message
                            : "Workspace access verified",
                        ...(decision.behavior === "allow"
                          ? { updatedInput: decision.updatedInput }
                          : {}),
                      },
                    };
                  },
                ],
              },
            ],
            PostToolUse: [
              {
                hooks: [
                  async (hook: {
                    tool_name: string;
                    tool_input: Record<string, unknown>;
                    tool_use_id?: string;
                  }) => {
                    emit("agent.tool.completed", {
                      name: hook.tool_name,
                      id: hook.tool_use_id,
                    });
                    if (hook.tool_name === "Edit" || hook.tool_name === "Write")
                      emit("agent.file.changed", {
                        path: hook.tool_input.file_path,
                      });
                    return {};
                  },
                ],
              },
            ],
          },
        },
      })) {
        if (message.type === "system" && message.subtype === "init")
          emit("agent.connected", { sessionId: message.session_id });
        if (message.type === "assistant")
          for (const block of message.message?.content ?? []) {
            if (block.type === "text")
              emit("agent.output", { text: block.text });
            if (block.type === "tool_use")
              emit("agent.tool.started", { id: block.id, name: block.name });
          }
        if (message.type === "result") {
          if (input.sessionId && message.is_error && isMissingSession(new Error([message.result, ...(message.errors ?? [])].filter(Boolean).join("\n"))))
            throw new ProviderError("Native session not found");
          if (message.is_error || message.subtype !== "success")
            throw new ProviderError(
              `Claude execution failed: ${message.subtype ?? "unknown"}`,
            );
          result = {
            output: message.result ?? "",
            ...(message.session_id ? { sessionId: message.session_id } : {}),
            usage: {
              inputTokens: message.usage?.input_tokens ?? null,
              outputTokens: message.usage?.output_tokens ?? null,
              // SDK total_cost_usd is an estimated cumulative session total,
              // including prior resumed turns. It is neither billed nor task-local.
              costUsd: null,
            },
          };
        }
      }
      signal.throwIfAborted();
      if (!result)
        throw new ProviderError("Claude ended without a final result");
      return result;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
