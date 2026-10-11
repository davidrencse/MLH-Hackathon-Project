// Exercises the complete backend without opening a port or using credentials.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
const directory = await mkdtemp(join(tmpdir(), "ghostgrid-demo-"));
const { app } = await buildApp({
  config: loadConfig({ GHOSTGRID_DATA_DIR: directory }),
  logger: false,
});
async function request(method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
  });
  if (response.statusCode >= 400) throw new Error(response.body);
  return response.json();
}
try {
  const project = await request("POST", "/api/v1/projects", {
    name: "Demo district",
  });
  const provider = await request("POST", "/api/v1/providers", {
    name: "Demo mock",
    type: "mock",
  });
  const agent = await request("POST", "/api/v1/agents", {
    name: "Router Spire",
    buildingId: "router-spire",
    projectId: project.id,
    providerId: provider.id,
  });
  const session = await request("POST", `/api/v1/agents/${agent.id}/sessions`, {
    name: "Mission control",
  });
  const task = await request(
    "POST",
    `/api/v1/sessions/${session.id}/messages`,
    { prompt: "Summarize the operational capacity of this district." },
  );
  let result: any;
  for (let attempt = 0; attempt < 100; attempt++) {
    result = await request("GET", `/api/v1/tasks/${task.id}`);
    if (["completed", "failed"].includes(result.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (result.status !== "completed")
    throw new Error(`Demo task did not complete: ${JSON.stringify(result)}`);
  const events = await request("GET", `/api/v1/sessions/${session.id}/events`);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        buildingId: agent.buildingId,
        sessionId: session.id,
        result: result.result,
        eventTypes: events.items.map((event: any) => event.type),
        metrics: await request("GET", "/api/v1/metrics"),
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
