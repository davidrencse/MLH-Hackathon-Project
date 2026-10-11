import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

describe("offline example bots", () => {
  it("bounds commit history without dropping new-commit reporting", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ghostgrid-commit-history-"),
    );
    const preload = join(directory, "fetch-fixture.mjs");
    await writeFile(
      preload,
      `globalThis.fetch = async () => new Response(JSON.stringify(['c','b','a'].map(sha => ({sha,commit:{message:sha}}))));`,
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        preload,
        resolve("examples/bots/scripts/repo_commit_watcher.mjs"),
        "--history-limit",
        "2",
        "--interval",
        "3600",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let stopping = false;
    const closed = new Promise<number | null>((done) =>
      child.once("close", done),
    );
    const deadline = setTimeout(() => child.kill("SIGKILL"), 2000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!stopping && output.includes('"bot.metric"')) {
        stopping = true;
        child.kill("SIGTERM");
      }
    });
    try {
      expect(await closed).toBe(0);
      const metric = output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .find((row) => row.type === "bot.metric");
      expect(metric.data).toMatchObject({
        tracked: 2,
        latest: "c",
        newCommits: 0,
      });
    } finally {
      clearTimeout(deadline);
      child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  }, 3000);
  it("stops market signals promptly even with a long tick interval", async () => {
    const child = spawn(
      process.execPath,
      [
        resolve("examples/bots/scripts/market_signal.mjs"),
        "--interval",
        "3600",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const closed = new Promise<number | null>((done) =>
      child.once("close", done),
    );
    let output = "";
    let stopping = false;
    const deadline = setTimeout(() => child.kill("SIGKILL"), 2000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!stopping && output.includes("online")) {
        stopping = true;
        child.kill("SIGTERM");
      }
    });
    try {
      expect(await closed).toBe(0);
      expect(output).toContain("stopped");
    } finally {
      clearTimeout(deadline);
      child.kill("SIGKILL");
    }
  }, 3000);

  it("interrupts an RSS request during shutdown", async () => {
    const server = createServer((_req, response) => {
      response.writeHead(200, { "Content-Type": "application/xml" });
      response.write("<rss>");
      child.kill("SIGTERM");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address() as { port: number };
    const child = spawn(
      "python3",
      [
        "-B",
        resolve("examples/bots/scripts/rss_watcher.py"),
        "--feed",
        `http://127.0.0.1:${address.port}/feed`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    const closed = new Promise<number | null>((done) =>
      child.once("close", done),
    );
    const deadline = setTimeout(() => child.kill("SIGKILL"), 2000);
    try {
      expect(await closed).toBe(0);
      expect(output).toContain("rss watcher stopped");
      expect(output).not.toContain("poll failed");
    } finally {
      clearTimeout(deadline);
      child.kill("SIGKILL");
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  }, 3000);

  it("uses the highest observed log severity and bounds RSS deduplication", async () => {
    const logScript = resolve("examples/bots/scripts/log_watchtower.py");
    const rssScript = resolve("examples/bots/scripts/rss_watcher.py");
    const { stdout } = await promisify(execFile)("python3", [
      "-B",
      "-c",
      `
import importlib.util, contextlib, io, json, sys
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
log = load("log", ${JSON.stringify(logScript)})
assert log.threat_level({"critical": 1, "high": 100, "low": 1000}) == "critical"
assert log.threat_level({"critical": 0, "high": 0, "medium": 0, "low": 0}) == "none"
rss = load("rss", ${JSON.stringify(rssScript)})
rss.urllib.request.urlopen = lambda *a, **kw: io.BytesIO(b'<rss><channel><item><guid>a</guid></item><item><guid>b</guid></item><item><guid>c</guid></item><item><guid>c</guid></item></channel></rss>')
sys.argv = ["rss", "--interval", "0", "--max-polls", "2", "--history-limit", "2"]
rss.main()
`,
    ]);
    const metrics = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((row) => row.type === "bot.metric");
    expect(metrics).toHaveLength(2);
    expect(metrics.every((row) => row.data.tracked === 2)).toBe(true);
    expect(metrics[1].data.new).toBe(3);
  });
  it.each(["http_healthcheck.mjs", "repo_commit_watcher.mjs"])(
    "%s aborts an in-flight request on SIGTERM",
    async (script) => {
      const directory = await mkdtemp(join(tmpdir(), "ghostgrid-bot-test-"));
      const preload = join(directory, "fetch-fixture.mjs");
      await writeFile(
        preload,
        `
        globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
          if (!options.signal) throw new Error('missing request cancellation signal');
          const pendingSocket = setInterval(() => {}, 1000);
          options.signal.addEventListener('abort', () => { clearInterval(pendingSocket); reject(options.signal.reason); }, { once: true });
          process.stdout.write('fixture request started\\n');
        });
      `,
      );
      const child = spawn(
        process.execPath,
        ["--import", preload, resolve("examples/bots/scripts", script)],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      let errors = "";
      let stopped = false;
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      const closed = new Promise<number | null>((resolveExit, reject) => {
        child.once("error", reject);
        child.once("close", resolveExit);
      });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 2500);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (!stopped && output.includes("fixture request started")) {
          stopped = true;
          child.kill("SIGTERM");
        }
      });
      try {
        const exitCode = await closed;
        expect(exitCode, JSON.stringify({ errors, output, stopped })).toBe(0);
        expect(output).toContain("stopped");
        expect(output).not.toContain("unreachable");
        expect(output).not.toContain("poll failed");
      } finally {
        clearTimeout(deadline);
        child.kill("SIGKILL");
        await rm(directory, { recursive: true, force: true });
      }
    },
    4000,
  );

  it("parses Atom href links for deduplication and item URLs", async () => {
    const script = resolve("examples/bots/scripts/rss_watcher.py");
    const { stdout } = await promisify(execFile)("python3", [
      "-B",
      "-c",
      `
import importlib.util, json
spec = importlib.util.spec_from_file_location("rss", ${JSON.stringify(script)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(module.parse_items(b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>one</title><link rel="self" href="https://fixture.invalid/self"/><link href="https://fixture.invalid/one"/></entry></feed>')))
`,
    ]);
    expect(JSON.parse(stdout)).toEqual([
      {
        id: "https://fixture.invalid/one",
        title: "one",
        link: "https://fixture.invalid/one",
      },
    ]);
  });
});
