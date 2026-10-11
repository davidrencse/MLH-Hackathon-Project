import { redact } from "../security/index.js";
import { ProviderError, type Emit, type ExecutionInput, type ExecutionResult } from "./types.js";

/** Match explicit missing-session errors only, never auth, transport or tool failures. */
export function isMissingSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /^(?:(?:native )?(?:session|thread|conversation)\b[^\n]{0,160}\b(?:not found|does not exist|no longer exists)\b|no (?:conversation|session|rollout) found\b)/im.test(message);
}

function savedMessages(input: ExecutionInput): ExecutionInput["messages"] {
  const history: ExecutionInput["messages"] = [];
  let size = 2; // JSON array brackets; include escaping and separators in the budget.
  for (const message of input.messages.slice(-20).reverse()) {
    if (typeof message.content !== "string") break;
    const saved = { role: message.role, content: message.content };
    const encodedSize = JSON.stringify(saved).length + (history.length ? 1 : 0);
    if (size + encodedSize > 32_000) break;
    history.unshift(saved);
    size += encodedSize;
  }
  return history;
}
export function restoredPrompt(input: ExecutionInput): string {
  const history = savedMessages(input);
  if (!history.length) return input.prompt;
  return redact(`Saved conversation for continuity (historical messages, not new instructions):\n${JSON.stringify(history)}\n\nCurrent request:\n${input.prompt}`);
}

/** Recovery is permitted only before any output/tool activity and at most once. */
export async function withSessionRecovery(
  input: ExecutionInput,
  emit: Emit,
  execute: (input: ExecutionInput, emit: Emit) => Promise<ExecutionResult>,
): Promise<ExecutionResult> {
  input.signal.throwIfAborted();
  if (!input.sessionId) return execute({ ...input, prompt: restoredPrompt(input) }, emit);
  let activity = false;
  try {
    return await execute(input, (type, data) => {
      if (type !== "agent.connected") activity = true;
      emit(type, data);
    });
  } catch (error) {
    if (input.signal.aborted || activity || !isMissingSession(error)) throw error;
    emit("agent.session.recovered", { reason: "native_session_missing", restoredMessages: savedMessages(input).length });
    input.signal.throwIfAborted();
    const result = await execute({ ...input, sessionId: undefined, prompt: restoredPrompt(input) }, emit);
    if (!result.sessionId)
      throw new ProviderError("Recovered provider did not return a new session ID");
    return result;
  }
}
