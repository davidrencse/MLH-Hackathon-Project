// Why: the frontend and the backend are two projects in one tree, and nothing checked that every
// route the app asks for exists on the server. It cost a working feature once already — the desk
// message box shipped against a backend that had never heard of `/api/v1/office/activity/message`,
// and the only symptom was "Route not found" in the operator's face.
//
// This reads the app's own API layer as text, pulls out every (method, path) it can ask for, and
// checks each one against the routes this backend actually registers. It is a contract test, not a
// style test: a path the app never calls is listed for information, never failed on.
//
// Paths are compared with their parameters flattened (`/tasks/:p/events`), because the app writes
// `${id}` where the server writes `{id}`.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/db/store.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const API_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../ghostgrid-frontend/frontend/src/api",
);

/** `${...}` holes and `{...}` params both become `:p`, and a query string is not part of a route. */
const normalize = (path: string) =>
  path
    .replace(/\$\{[^}]*\}/g, ":p")
    .replace(/\{[^}]+\}/g, ":p")
    .split("?")[0]!
    .replace(/\/$/, "");

interface Call {
  endpoint: string;
  file: string;
}

/**
 * Every endpoint the app can ask for, read out of its API layer.
 *
 * Only the call helpers are matched — `request('GET', path)`, the paged readers, the two `gg*`
 * helpers and the SSE opener. A bare path string elsewhere in the file is deliberately ignored:
 * `client.ts` passes one to its request log as a label, and that is not a call.
 */
function frontendCalls(): Call[] {
  const calls = new Map<string, string>();
  const add = (method: string, path: string, file: string) => {
    const route = normalize(path);
    if (!route.startsWith("/api/v1")) return;
    calls.set(`${method} ${route}`, calls.get(`${method} ${route}`) ?? file);
  };
  for (const file of readdirSync(API_DIR).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(join(API_DIR, file), "utf8");
    for (const match of source.matchAll(
      /request(?:<[^>]*>)?\(\s*'([A-Z]+)'\s*,\s*[`'"]([^`'"]+)[`'"]/g,
    ))
      add(match[1]!, match[2]!, file);
    // A ternary that picks between two literal paths: `request('POST', cond ? `/a` : `/b`)`.
    for (const match of source.matchAll(
      /request(?:<[^>]*>)?\(\s*'([A-Z]+)'\s*,\s*[^,]*\?\s*[`'"]([^`'"]+)[`'"]\s*:\s*[`'"]([^`'"]+)[`'"]/g,
    )) {
      add(match[1]!, match[2]!, file);
      add(match[1]!, match[3]!, file);
    }
    for (const match of source.matchAll(/page(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g))
      add("GET", match[1]!, file);
    for (const match of source.matchAll(/eventPage\(\s*[`'"]([^`'"]+)[`'"]/g))
      add("GET", match[1]!, file);
    for (const match of source.matchAll(/ggList(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g))
      add("GET", match[1]!, file);
    for (const match of source.matchAll(/ggPost(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g))
      add("POST", match[1]!, file);
    for (const match of source.matchAll(/openStream\(\s*[`'"]([^`'"]+)[`'"]/g))
      add("GET", match[1]!, file);
  }
  return [...calls.entries()].map(([endpoint, file]) => ({ endpoint, file })).sort(
    (left, right) => left.endpoint.localeCompare(right.endpoint),
  );
}

/** Every route this backend registers, from the spec it serves. */
async function backendRoutes(): Promise<Set<string>> {
  const root = await mkdtemp(join(tmpdir(), "ghostgrid-contract-"));
  try {
    const store = new Store(join(root, "db.sqlite"));
    const built = await buildApp({
      store,
      config: { ...loadConfig(), databasePath: join(root, "db.sqlite"), dataDir: root, allowedWorkspaces: [root] },
      startWorker: false,
      logger: false,
    });
    try {
      const spec = (await built.app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json() as {
        paths: Record<string, Record<string, unknown>>;
      };
      return new Set(
        Object.entries(spec.paths).flatMap(([path, operations]) =>
          Object.keys(operations).map((method) => `${method.toUpperCase()} ${normalize(path)}`),
        ),
      );
    } finally {
      await built.app.close();
      await built.engine.stop();
      store.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe.skipIf(!existsSync(API_DIR))("the app's API layer against this backend", () => {
  it("asks for nothing this backend does not serve", async () => {
    const routes = await backendRoutes();
    const calls = frontendCalls();
    // A sanity floor: an extractor that silently stops matching would otherwise pass forever.
    expect(calls.length).toBeGreaterThan(60);
    const missing = calls.filter((call) => !routes.has(call.endpoint));
    expect(
      missing.map((call) => `${call.endpoint}  (called from api/${call.file})`),
      "the app calls these, and this backend does not register them",
    ).toEqual([]);
  }, 30_000);

  it("reads every paged endpoint from a route that really pages", async () => {
    // `page()` and `eventPage()` unwrap `{ items, total }`. A route that answers with a bare array
    // or a bare object would come back as `undefined` items in the UI rather than as an error.
    const root = await mkdtemp(join(tmpdir(), "ghostgrid-paged-"));
    try {
      const store = new Store(join(root, "db.sqlite"));
      const project = store.insert("projects", { name: "Contract" });
      const built = await buildApp({
        store,
        config: { ...loadConfig(), databasePath: join(root, "db.sqlite"), dataDir: root, allowedWorkspaces: [root] },
        startWorker: false,
        logger: false,
      });
      try {
        // The collection readers the app pages through, with whatever query each one needs.
        const paged: [string, Record<string, string>][] = [
          ["/api/v1/projects", {}],
          ["/api/v1/providers", {}],
          ["/api/v1/agents", { projectId: project.id }],
          ["/api/v1/sessions", { projectId: project.id }],
          ["/api/v1/tasks", { projectId: project.id }],
          ["/api/v1/workflows", { projectId: project.id }],
          ["/api/v1/events", {}],
        ];
        for (const [url, query] of paged) {
          const search = new URLSearchParams(query).toString();
          const response = await built.app.inject({ method: "GET", url: search ? `${url}?${search}` : url });
          expect(response.statusCode, `${url} answered ${response.statusCode}`).toBe(200);
          const body = response.json() as { items?: unknown };
          expect(Array.isArray(body.items), `${url} must answer with an items array`).toBe(true);
        }
      } finally {
        await built.app.close();
        await built.engine.stop();
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
