// Exercise compiled imports, copied migrations, HTTP authentication and disk persistence.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";

const directory = await mkdtemp(join(tmpdir(), "ghostgrid-built-"));
const token = "compiled-smoke-fixture";
const config = loadConfig({ GHOSTGRID_DATA_DIR: directory, GHOSTGRID_API_TOKEN: token });
let app;
try {
  ({ app } = await buildApp({ config, logger: false }));
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const unauthorized = await fetch(`${address}/health`);
  assert.equal(unauthorized.status, 401);
  await unauthorized.arrayBuffer();
  const health = await fetch(`${address}/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const project = await app.inject({
    method: "POST", url: "/api/v1/projects",
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "Compiled persistence fixture" },
  });
  assert.equal(project.statusCode, 201);
  const id = project.json().id;
  await app.close();
  app = undefined;
  ({ app } = await buildApp({ config, logger: false }));
  const restored = await app.inject({
    method: "GET", url: `/api/v1/projects/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().name, "Compiled persistence fixture");
  console.log("Compiled HTTP, authentication, migrations and persistence smoke check passed");
} finally {
  try { await app?.close(); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
