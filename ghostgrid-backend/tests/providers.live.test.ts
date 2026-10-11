/** Explicit paid/provider-authenticated smoke tests. Never run without BOTH opt-in and credentials. */
import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { ExecutionInput, ProviderConfig } from "../src/providers/types.js";
const optedIn = process.env.GHOSTGRID_LIVE_TEST === "1";
const configurations: ProviderConfig[] = [
  {
    id: "live-codex",
    name: "Codex smoke",
    type: "codex",
    apiKeyEnv: "OPENAI_API_KEY",
    concurrency: 1,
    timeoutMs: 120_000,
  },
  {
    id: "live-claude",
    name: "Claude smoke",
    type: "claude",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    concurrency: 1,
    timeoutMs: 120_000,
  },
  {
    id: "live-deepseek",
    name: "DeepSeek smoke",
    type: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    model: process.env.DEEPSEEK_MODEL,
    concurrency: 1,
    timeoutMs: 120_000,
  },
];
describe("explicitly opted-in real provider smoke tests", () => {
  for (const config of configurations) {
    const workspace = process.env.GHOSTGRID_LIVE_WORKSPACE;
    const enabled =
      optedIn &&
      !!process.env[config.apiKeyEnv!] &&
      (config.type === "deepseek" ? !!config.model : !!workspace);
    it.skipIf(!enabled)(
      config.type,
      async () => {
        const input: ExecutionInput = {
          prompt: "Reply with only the word hello. Do not use tools.",
          messages: [],
          signal: AbortSignal.timeout(120_000),
          workspace,
          agent: { id: "smoke", permissions: ["read"] },
        };
        const result = await new ProviderRegistry()
          .get(config)
          .executeTask(input, () => {});
        expect(result.output.toLowerCase()).toContain("hello");
      },
      130_000,
    );
  }
});
