import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliActivity, projectSlug } from "../src/office/cliActivity.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const close of cleanup.splice(0).reverse()) await close();
});

/** A fake ~/.claude: one session registry entry plus the transcript it points at. */
async function fixture(opts: {
  pid: number;
  sessionId?: string;
  cwd?: string;
  lines?: unknown[];
  registry?: Record<string, unknown>;
  transcriptAt?: string;
}) {
  const home = await mkdtemp(join(tmpdir(), "ghostgrid-claude-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  vi.stubEnv("GHOSTGRID_CLAUDE_HOME", home);
  const sessionId = opts.sessionId ?? "11111111-2222-4333-8444-555555555555";
  const cwd = opts.cwd ?? "/home/u/projects/app";
  await mkdir(join(home, "sessions"), { recursive: true });
  await writeFile(
    join(home, "sessions", `${opts.pid}.json`),
    JSON.stringify({
      sessionId, cwd, pid: opts.pid, name: "app-7f", status: "busy",
      version: "2.1.296", startedAt: 1_700_000_000_000, updatedAt: 1_700_000_900_000,
      ...opts.registry,
    }),
  );
  if (opts.lines) {
    const dir = opts.transcriptAt ?? join(home, "projects", projectSlug(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.jsonl`), opts.lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  return { home, sessionId, cwd };
}

const assistant = (content: unknown[]) => ({ type: "assistant", timestamp: "2026-10-13T10:00:00.000Z", message: { content } });

describe("cli activity", () => {
  it("reads the session a pid owns and turns its transcript into terminal lines", async () => {
    await fixture({
      pid: 4242,
      lines: [
        { type: "user", timestamp: "2026-10-13T09:59:00.000Z", message: { content: "make the office real" } },
        assistant([{ type: "text", text: "Reading the office code." }]),
        assistant([{ type: "tool_use", name: "Bash", input: { command: "ls src/city/office" } }]),
        assistant([{ type: "tool_use", name: "Edit", input: { file_path: "/repo/src/app.ts" } }]),
        { type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "ENOENT: missing" }] } },
        { type: "attachment", attachment: { type: "hook_success", hookName: "SessionStart:startup" } },
        { type: "user", message: { content: [{ type: "tool_result", is_error: false, content: "quiet success" }] } },
      ],
    });
    const activity = await cliActivity(4242);
    expect(activity).toMatchObject({ pid: 4242, name: "app-7f", status: "busy", version: "2.1.296" });
    expect(activity!.startedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(activity!.lines.map((l) => [l.kind, l.text])).toEqual([
      ["prompt", "make the office real"],
      ["say", "Reading the office code."],
      ["tool", "Bash: ls src/city/office"],
      ["tool", "Edit: /repo/src/app.ts"],
      ["error", "ENOENT: missing"],
      ["hook", "SessionStart:startup (success)"],
    ]);
    // A successful tool result is noise in a terminal of this size.
    expect(JSON.stringify(activity!.lines)).not.toContain("quiet success");
  });

  it("returns the newest lines only, up to the requested limit", async () => {
    await fixture({
      pid: 77,
      lines: Array.from({ length: 50 }, (_, i) => assistant([{ type: "tool_use", name: "Bash", input: { command: `step-${i}` } }])),
    });
    const activity = await cliActivity(77, 5);
    expect(activity!.lines).toHaveLength(5);
    expect(activity!.lines.at(-1)!.text).toBe("Bash: step-49");
    expect(activity!.lines[0].text).toBe("Bash: step-45");
  });

  it("clips a long line instead of handing the office a wall of text", async () => {
    await fixture({ pid: 78, lines: [assistant([{ type: "text", text: "x".repeat(5000) }])] });
    const activity = await cliActivity(78);
    expect(activity!.lines[0].text.length).toBeLessThanOrEqual(200);
    expect(activity!.lines[0].text.endsWith("…")).toBe(true);
  });

  it("has no session for a pid the CLI never registered", async () => {
    await fixture({ pid: 100, lines: [] });
    expect(await cliActivity(999)).toBeNull();
  });

  it("refuses a registry whose session id is not a uuid", async () => {
    await fixture({ pid: 101, registry: { sessionId: "../../../etc/passwd" }, lines: [] });
    expect(await cliActivity(101)).toBeNull();
  });

  it("never reads a transcript outside the projects directory", async () => {
    // A `cwd` of "/" slugs to "-", whose parent traversal must not escape ~/.claude/projects.
    const { home, sessionId } = await fixture({ pid: 102, cwd: "/../../secrets", lines: [] });
    await mkdir(join(home, "..", "secrets"), { recursive: true }).catch(() => {});
    await writeFile(
      join(home, "sessions", "102.json"),
      JSON.stringify({ sessionId, cwd: "/../../secrets", pid: 102, name: "x", status: "idle" }),
    );
    const activity = await cliActivity(102);
    // The session still resolves (it is a real registry entry); only its transcript is refused.
    expect(activity).not.toBeNull();
    expect(activity!.lines).toEqual([]);
  });

  it("refuses a transcript that is a symlink out of the projects root", async () => {
    // A link planted in the projects tree would otherwise turn this route into an arbitrary
    // file read for anything the backend can open. safePath resolves links; a string prefix
    // check does not, which is what this guards.
    const { symlink, mkdtemp: mkTemp, writeFile: write } = await import("node:fs/promises");
    const outside = await mkTemp(join(tmpdir(), "ghostgrid-outside-"));
    cleanup.push(() => rm(outside, { recursive: true, force: true }));
    const secret = join(outside, "secret.jsonl");
    await write(secret, JSON.stringify(assistant([{ type: "text", text: "not yours to read" }])) + "\n");

    const { home, cwd, sessionId } = await fixture({ pid: 500 });
    await mkdir(join(home, "projects", projectSlug(cwd)), { recursive: true });
    await symlink(secret, join(home, "projects", projectSlug(cwd), `${sessionId}.jsonl`));

    const activity = await cliActivity(500);
    expect(activity).not.toBeNull(); // the session still resolves
    expect(activity!.lines).toEqual([]); // but nothing is read through the link
  });

  it("survives a half-written last line while the CLI is mid-append", async () => {
    const { home, cwd, sessionId } = await fixture({ pid: 103, lines: [assistant([{ type: "text", text: "done" }])] });
    const path = join(home, "projects", projectSlug(cwd), `${sessionId}.jsonl`);
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, '{"type":"assistant","message":{"content":[{"type":"text","text":"trun');
    const activity = await cliActivity(103);
    expect(activity!.lines.map((l) => l.text)).toEqual(["done"]);
  });

  // A coding CLI delegates to subagents of its own. Before this, their work arrived folded into
  // the spawning desk's transcript, so a terminal running five agents drew as one busy desk.
  it("reports the subagents a CLI spawned for itself, as workers rather than tool calls", async () => {
    await fixture({
      pid: 220,
      lines: [
        assistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
        assistant([
          { type: "tool_use", id: "t2", name: "Agent", input: { description: "Review the diff", subagent_type: "fork", prompt: "..." } },
          { type: "tool_use", id: "t3", name: "Agent", input: { description: "Map the API surface", subagent_type: "general-purpose", prompt: "..." } },
        ]),
        // The older spelling of the same spawn, and one with no description to label it by.
        assistant([{ type: "tool_use", id: "t4", name: "Task", input: { subagent_type: "explore" } }]),
      ],
    });
    const activity = await cliActivity(220);
    expect(activity!.subagents).toEqual([
      { id: "t2", description: "Review the diff", agentType: "fork", at: "2026-10-13T10:00:00.000Z" },
      { id: "t3", description: "Map the API surface", agentType: "general-purpose", at: "2026-10-13T10:00:00.000Z" },
      { id: "t4", description: "explore", agentType: "explore", at: "2026-10-13T10:00:00.000Z" },
    ]);
    // A spawn is its own kind of line, so the ticker can say "hired" rather than "ran a tool".
    const kinds = activity!.lines.map((l) => l.kind);
    expect(kinds).toEqual(["tool", "subagent", "subagent", "subagent"]);
    expect(activity!.lines[1].text).toBe("Review the diff (fork)");
  });

  it("gives a CLI that works alone no subagents at all", async () => {
    await fixture({ pid: 221, lines: [assistant([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a/b.ts" } }])] });
    const activity = await cliActivity(221);
    expect(activity!.subagents).toEqual([]);
  });
});
