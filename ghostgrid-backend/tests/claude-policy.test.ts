import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeAdapter, claudeToolPolicy } from "../src/providers/claude.js";
import type { ExecutionInput } from "../src/providers/types.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ghostgrid-policy-"));
  directories.push(root);
  await mkdir(join(root, "tree"));
  await writeFile(
    join(root, "tree", ".git"),
    "gitdir: /separate/repository/worktrees/task\n",
  );
  const input: ExecutionInput = {
    prompt: "test",
    messages: [],
    workspace: join(root, "tree"),
    signal: new AbortController().signal,
    agent: { id: "a", permissions: ["read", "write"], workspace: root },
  };
  return { root, input };
}
describe("Claude file permission boundary", () => {
  it("rejects recursive searches beyond the depth budget", async () => {
    const { input } = await fixture();
    await mkdir(
      join(input.workspace!, "src", ...Array.from({ length: 65 }, () => "d")),
      { recursive: true },
    );
    expect(
      (await claudeToolPolicy(input, "Grep", { path: "src", pattern: "." }))
        .behavior,
    ).toBe("deny");
  });
  it("passes canonical inputs through the SDK pre-tool hook", async () => {
    const { input } = await fixture();
    await mkdir(join(input.workspace!, "src"));
    const adapter = new ClaudeAdapter({
      id: "p",
      name: "fixture",
      type: "claude",
      timeoutMs: 1000,
      concurrency: 1,
    });
    const hookResults: unknown[] = [];
    vi.spyOn(adapter as any, "sdk").mockResolvedValue({
      async *query({ options }: any) {
        hookResults.push(
          await options.hooks.PreToolUse[0].hooks[0]({
            tool_name: "Grep",
            tool_input: { path: "src", pattern: "safe" },
          }),
        );
        yield { type: "result", subtype: "success", result: "done" };
      },
    });
    await adapter.executeTask(input, () => {});
    expect(hookResults).toMatchObject([
      {
        hookSpecificOutput: {
          permissionDecision: "allow",
          updatedInput: {
            path: join(input.workspace!, "src"),
            pattern: "safe",
          },
        },
      },
    ]);
  });
  it("allows recursive search only in fully inspected safe subtrees", async () => {
    const { input } = await fixture();
    const src = join(input.workspace!, "src");
    await mkdir(src);
    await writeFile(join(src, "code.ts"), "safe source");
    expect(
      await claudeToolPolicy(input, "Grep", { path: "src", pattern: "." }),
    ).toEqual({ behavior: "allow", updatedInput: { path: src, pattern: "." } });
    expect(
      (
        await claudeToolPolicy(input, "Glob", {
          path: "src",
          pattern: "**/*.ts",
        })
      ).behavior,
    ).toBe("allow");
    // Scanning the root would include Git metadata, even without an explicit
    // request for that metadata. Reject before the native tool reads anything.
    expect(
      (await claudeToolPolicy(input, "Grep", { pattern: "." })).behavior,
    ).toBe("deny");
    await writeFile(join(src, ".env"), "secret contents");
    expect(
      (await claudeToolPolicy(input, "Grep", { path: "src", pattern: "." }))
        .behavior,
    ).toBe("deny");
    expect(
      (await claudeToolPolicy(input, "Glob", { path: "src", pattern: "*.ts" }))
        .behavior,
    ).toBe("deny");
    expect(
      (
        await claudeToolPolicy(input, "Grep", {
          path: "src/code.ts",
          pattern: ".",
        })
      ).behavior,
    ).toBe("allow");
  });
  it("rejects nested search symlinks and escaping Glob patterns", async () => {
    const { root, input } = await fixture();
    await mkdir(join(input.workspace!, "src"));
    await writeFile(join(root, "outside.txt"), "outside");
    await symlink(
      join(root, "outside.txt"),
      join(input.workspace!, "src", "alias"),
    );
    expect(
      (await claudeToolPolicy(input, "Grep", { path: "src", pattern: "." }))
        .behavior,
    ).toBe("deny");
    await rm(join(input.workspace!, "src", "alias"));
    for (const pattern of [
      "../outside.txt",
      "**/../../outside.txt",
      "/tmp/*",
      "{../outside.txt,code.ts}",
      "@(../outside.txt)",
    ])
      expect(
        (await claudeToolPolicy(input, "Glob", { path: "src", pattern }))
          .behavior,
      ).toBe("deny");
  });
  it("rejects nested credential aliases irrespective of case", async () => {
    const { input } = await fixture();
    await mkdir(join(input.workspace!, "src"));
    for (const name of [".NPMRC", ".NETRC", ".ENVRC", "ID_RSA", ".KUBE"]) {
      await writeFile(join(input.workspace!, "src", name), "credential");
      expect(
        (await claudeToolPolicy(input, "Grep", { path: "src", pattern: "." }))
          .behavior,
      ).toBe("deny");
      await rm(join(input.workspace!, "src", name));
    }
  });
  it("allows new nested files only in isolated worktrees", async () => {
    const { input } = await fixture();
    expect(
      (
        await claudeToolPolicy(input, "Write", {
          file_path: "new/nested/code.ts",
        })
      ).behavior,
    ).toBe("allow");
    await rm(join(input.workspace!, ".git"));
    expect(
      (await claudeToolPolicy(input, "Write", { file_path: "code.ts" }))
        .behavior,
    ).toBe("deny");
  });
  it("rejects a new file below an escaping parent symlink", async () => {
    const { root, input } = await fixture();
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(input.workspace!, "escape"));
    expect(
      (await claudeToolPolicy(input, "Write", { file_path: "escape/new.ts" }))
        .behavior,
    ).toBe("deny");
  });
  it("rejects sensitive files, traversal, source writes and shell", async () => {
    const { input } = await fixture();
    for (const path of [
      ".git",
      "../escape.ts",
      ".env",
      ".env.local",
      "secrets.json",
      "key.pem",
      ".claude/settings.json",
    ])
      expect(
        (await claudeToolPolicy(input, "Write", { file_path: path })).behavior,
      ).toBe("deny");
    expect(
      (await claudeToolPolicy(input, "Bash", { command: "rm -rf ." })).behavior,
    ).toBe("deny");
    expect(
      (
        await claudeToolPolicy(
          { ...input, agent: { ...input.agent, workspace: input.workspace } },
          "Write",
          { file_path: "code.ts" },
        )
      ).behavior,
    ).toBe("deny");
  });
  it("requires explicit write capability", async () => {
    const { input } = await fixture();
    expect(
      (
        await claudeToolPolicy(
          { ...input, agent: { id: "a", permissions: ["read"] } },
          "Edit",
          { file_path: "code.ts" },
        )
      ).behavior,
    ).toBe("deny");
  });
});
