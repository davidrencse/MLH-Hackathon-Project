// The guards around continuing somebody's live CLI session. The CLI itself is not run here: the
// runner is injected, so these cover what the backend decides before it spawns anything.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { messageCliSession, MAX_PROMPT } from "../src/office/cliMessage.js";

const SESSION = "11111111-2222-4333-8444-555555555555";

async function claudeHome(cwd: string | null, pid = 4242) {
  const home = await mkdtemp(join(tmpdir(), "ghostgrid-climsg-"));
  await mkdir(join(home, "sessions"), { recursive: true });
  await writeFile(
    join(home, "sessions", `${pid}.json`),
    JSON.stringify({ sessionId: SESSION, cwd, name: "hackathon-1", status: "idle" }),
  );
  process.env.GHOSTGRID_CLAUDE_HOME = home;
  return home;
}

describe("messaging a live CLI desk", () => {
  const homes: string[] = [];
  afterEach(async () => {
    delete process.env.GHOSTGRID_CLAUDE_HOME;
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
  });

  it("continues that session, in its own directory, and says what it answered", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ghostgrid-ws-"));
    homes.push(workspace, await claudeHome(workspace));
    let seen: { args: string[]; cwd: string } | null = null;
    const reply = await messageCliSession(4242, "  what are you working on?  ", {
      allowedWorkspaces: [workspace],
      run: async (args, cwd) => {
        seen = { args, cwd };
        return JSON.stringify({ session_id: SESSION, result: "Reading the office panel.", total_cost_usd: 0.012, duration_ms: 2400 });
      },
    });
    // The whole point: the same session id, continued, rather than a fresh conversation.
    expect(seen!.args).toEqual(["--resume", SESSION, "-p", "what are you working on?", "--output-format", "json"]);
    expect(seen!.cwd).toBe(workspace);
    expect(reply).toEqual({
      sessionId: SESSION,
      copied: false,
      reply: "Reading the office panel.",
      costUsd: 0.012,
      durationMs: 2400,
    });
  });

  it("reports a copy as a copy, because the window on the machine will not show it", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ghostgrid-ws-"));
    homes.push(workspace, await claudeHome(workspace));
    const reply = await messageCliSession(4242, "ping", {
      allowedWorkspaces: [workspace],
      run: async () => JSON.stringify({ session_id: "99999999-2222-4333-8444-555555555555", result: "pong" }),
    });
    expect(reply.copied).toBe(true);
    expect(reply.sessionId).not.toBe(SESSION);
  });

  it("refuses a desk working outside the allowlist, and names the setting", async () => {
    const outside = await mkdtemp(join(tmpdir(), "ghostgrid-outside-"));
    const allowed = await mkdtemp(join(tmpdir(), "ghostgrid-ws-"));
    homes.push(outside, allowed, await claudeHome(outside));
    await expect(messageCliSession(4242, "hello", { allowedWorkspaces: [allowed], run: async () => "{}" }))
      .rejects.toThrow(/GHOSTGRID_ALLOWED_WORKSPACES/);
  });

  it("refuses a process with no session to continue, and an empty or oversized message", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ghostgrid-ws-"));
    homes.push(workspace, await claudeHome(workspace));
    const run = async () => JSON.stringify({ session_id: SESSION, result: "ok" });
    await expect(messageCliSession(999, "hello", { allowedWorkspaces: [workspace], run }))
      .rejects.toThrow(/no readable Claude session/i);
    await expect(messageCliSession(4242, "   ", { allowedWorkspaces: [workspace], run }))
      .rejects.toThrow(/write something/i);
    await expect(messageCliSession(4242, "x".repeat(MAX_PROMPT + 1), { allowedWorkspaces: [workspace], run }))
      .rejects.toThrow(/at most/i);
  });

  it("passes the CLI's own refusal through instead of reporting success", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ghostgrid-ws-"));
    homes.push(workspace, await claudeHome(workspace));
    await expect(messageCliSession(4242, "hello", {
      allowedWorkspaces: [workspace],
      run: async () => JSON.stringify({ is_error: true, result: "Session is busy in another window" }),
    })).rejects.toThrow(/busy in another window/i);
  });
});
