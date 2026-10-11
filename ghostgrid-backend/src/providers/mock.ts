import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import {
  ProviderError,
  type ProviderAdapter,
  type ExecutionInput,
  type Emit,
} from "./types.js";
/** Explicitly simulated provider. Commands are fixtures, never real execution. */
export class MockAdapter implements ProviderAdapter {
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
  async checkAvailability() {
    return { available: true, models: ["mock"] };
  }
  async executeTask(input: ExecutionInput, emit: Emit) {
    input.signal.throwIfAborted();
    const delay = Number(input.prompt.match(/\[delay:(\d+)\]/)?.[1] ?? 15);
    await setTimeout(Math.min(delay, 60_000), undefined, {
      signal: input.signal,
    });
    if (input.prompt.includes("[fail]"))
      throw new ProviderError("Requested mock failure");
    if (input.prompt.includes("[transient]"))
      throw new ProviderError("Requested mock transient failure", true);
    const output = `Mock response: ${input.prompt}`;
    emit("agent.output", { text: output });
    return {
      output,
      sessionId: input.sessionId ?? randomUUID(),
      usage: { inputTokens: null, outputTokens: null },
    };
  }
}
