import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const close of cleanup.splice(0).reverse()) await close();
});

// Scans every Claude Code / Codex transcript under the real home dirs, which on a developer
// machine is hundreds of megabytes, so the default 5s budget is not enough on a loaded box.
it("reports the tokens the backend recorded for each provider, not a fixed allowance", { timeout: 30_000 }, async () => {
  for (const key of ["DEEPSEEK_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY"]) vi.stubEnv(key, "");
  vi.stubGlobal("fetch", vi.fn());
  const directory = await mkdtemp(join(tmpdir(), "ghostgrid-credits-"));
  // The route also merges in whatever the local coding CLIs recorded. Pointed at the real
  // ~/.claude and ~/.codex this test reads the developer's own transcripts — hundreds of
  // megabytes on a used machine — so it asserted against machine state and timed out. Empty
  // homes keep the merge itself under test while the rows it contributes stay deterministic.
  vi.stubEnv("GHOSTGRID_CLAUDE_HOME", join(directory, "claude"));
  vi.stubEnv("GHOSTGRID_CODEX_HOME", join(directory, "codex"));
  const instance = await buildApp({ config: loadConfig({ GHOSTGRID_DATA_DIR: directory }), startWorker: false, logger: false });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { app, store } = instance;
  const project = store.insert("projects", { name: "Credits district" });
  const provider = store.insert("providers", { name: "Claude", type: "claude" });
  const agent = store.insert("agents", { name: "Tower", projectId: project.id, providerId: provider.id });
  const task = store.insert("tasks", { projectId: project.id, agentId: agent.id, status: "completed" });
  for (const usage of [
    { inputTokens: 1200, outputTokens: 400, costUsd: 0.21, estimatedCostUsd: null },
    { inputTokens: 300, outputTokens: 100, costUsd: null, estimatedCostUsd: 0.04 },
  ])
    store.insert("usage_records", {
      taskId: task.id, projectId: project.id, agentId: agent.id,
      providerId: provider.id, createdAt: new Date().toISOString(), ...usage,
    });

  const response = await app.inject({ method: "GET", url: "/api/v1/provider-credits" });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  const anthropic = body.rows.find((row: any) => row.provider === "anthropic");
  expect(anthropic).toMatchObject({
    tokensUsed: 2000, inputTokens: 1500, outputTokens: 500,
    requests: 2, reportedCostUsd: 0.21, estimatedCostUsd: 0.04,
  });
  // No key, no balance endpoint — but the recorded usage is still real.
  expect(anthropic.balanceUsd).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("demo");
  const untouched = body.rows.find((row: any) => row.provider === "groq");
  expect(untouched).toMatchObject({ status: "nokey", tokensUsed: 0, requests: 0 });
  expect(body.usage.totals.inputTokens).toBe(1500);

  const scoped = await app.inject({ method: "GET", url: `/api/v1/provider-credits?projectId=${project.id}` });
  expect(scoped.json().rows.find((row: any) => row.provider === "anthropic").tokensUsed).toBe(2000);
  const other = store.insert("projects", { name: "Empty district" });
  const empty = await app.inject({ method: "GET", url: `/api/v1/provider-credits?projectId=${other.id}` });
  expect(empty.json().rows.find((row: any) => row.provider === "anthropic").tokensUsed).toBe(0);
  expect((await app.inject({ method: "GET", url: "/api/v1/provider-credits?projectId=invalid" })).statusCode).toBe(400);
});
