// Synthetic, in-memory audit benchmark; never opens the application's database.
import { performance } from "node:perf_hooks";
import { Store } from "../src/db/store.js";

const store = new Store(":memory:");
try {
  const project = store.insert("projects", {});
  const provider = store.insert("providers", {});
  const agent = store.insert("agents", { projectId: project.id, providerId: provider.id });
  const history = 10_000;
  store.transaction(() => {
    for (let i = 0; i < history; i++)
      store.insert("tasks", {
        projectId: project.id,
        agentId: agent.id,
        status: i < history - 10 ? "completed" : "queued",
        result: "x".repeat(1000),
      });
  });
  const legacy = () => store.db.prepare("SELECT data FROM tasks ORDER BY rowid").all()
    .map((row) => JSON.parse(row.data as string))
    .filter((row) => row.status === "queued");
  const indexed = () => store.list("tasks", { status: "queued" });
  const measure = (read: () => unknown[]) => {
    read();
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      if (read().length !== 10) throw new Error("Unexpected benchmark result");
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    return durations[Math.floor(durations.length / 2)];
  };
  const legacyMs = measure(legacy);
  const indexedMs = measure(indexed);
  console.log(JSON.stringify({ history, queued: 10, samples: 20,
    medianLegacyMs: legacyMs, medianIndexedMs: indexedMs,
    speedup: legacyMs / indexedMs,
    decodedRowsBefore: history, decodedRowsAfter: 10,
  }, null, 2));
} finally {
  store.close();
}
