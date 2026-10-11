import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createOpenApi, registerOperation } from "../src/openapi.js";
describe("frontend OpenAPI contract", () => {
  it("documents global event history filters and its resumable cursor", () => {
    const spec = createOpenApi();
    registerOperation(spec, "GET", "/api/v1/events");
    const operation = spec.paths["/api/v1/events"].get;
    expect(
      operation.parameters.map((parameter: any) => parameter.name),
    ).toEqual(
      expect.arrayContaining([
        "after",
        "limit",
        "taskId",
        "sessionId",
        "agentId",
        "projectId",
      ]),
    );
    const schema =
      operation.responses["200"].content["application/json"].schema;
    expect(schema.properties.items.items.$ref).toBe(
      "#/components/schemas/Event",
    );
    expect(schema.properties.nextCursor.type).toBe("integer");
  });
  it("documents asynchronous creation, deletion and typed entity responses", () => {
    const spec = createOpenApi();
    registerOperation(
      spec,
      "POST",
      "/api/v1/tasks",
      z.object({ prompt: z.string() }),
    );
    registerOperation(
      spec,
      "POST",
      "/api/v1/projects",
      z.object({ name: z.string() }),
    );
    registerOperation(spec, "DELETE", "/api/v1/agents/:id");
    registerOperation(spec, "GET", "/api/v1/sessions/:id");
    expect(
      spec.paths["/api/v1/tasks"].post.responses["202"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/Task");
    expect(spec.paths["/api/v1/projects"].post.responses["201"]).toBeTruthy();
    expect(
      spec.paths["/api/v1/agents/{id}"].delete.responses["204"].content,
    ).toBeUndefined();
    expect(
      spec.paths["/api/v1/sessions/{id}"].get.responses["200"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/Session");
    expect(spec.components.schemas.TaskStatus.enum).toEqual([
      "pending",
      "queued",
      "running",
      "awaiting_approval",
      "completed",
      "failed",
      "cancelled",
    ]);
    expect(
      spec.paths["/api/v1/tasks"].post.requestBody.content["application/json"]
        .schema.required,
    ).toContain("prompt");
  });
  it("documents SSE filters, reconnection header and event envelope", () => {
    const spec = createOpenApi("token");
    registerOperation(spec, "GET", "/api/v1/events/stream");
    const op = spec.paths["/api/v1/events/stream"].get;
    expect(op.responses["200"].content["text/event-stream"]).toBeTruthy();
    expect(op.parameters.map((p: any) => p.name)).toEqual(
      expect.arrayContaining([
        "sessionId",
        "taskId",
        "agentId",
        "projectId",
        "after",
        "Last-Event-ID",
      ]),
    );
    expect(spec.components.schemas.Event.required).toEqual(
      expect.arrayContaining([
        "id",
        "seq",
        "timestamp",
        "type",
        "taskId",
        "data",
      ]),
    );
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    expect(op.responses["409"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/Error",
    );
  });
  it("documents entity lists, cursor events and plain artifact content", () => {
    const spec = createOpenApi();
    for (const path of [
      "/api/v1/tasks",
      "/api/v1/sessions/:id/events",
      "/api/v1/artifacts/:id/content",
    ])
      registerOperation(spec, "GET", path);
    const list =
      spec.paths["/api/v1/tasks"].get.responses["200"].content[
        "application/json"
      ].schema;
    expect(list.properties.items.items.$ref).toBe("#/components/schemas/Task");
    expect(list.properties.total.type).toBe("integer");
    const events =
      spec.paths["/api/v1/sessions/{id}/events"].get.responses["200"].content[
        "application/json"
      ].schema;
    expect(events.properties.nextCursor.type).toBe("integer");
    expect(events.properties.total).toBeUndefined();
    expect(
      spec.paths["/api/v1/artifacts/{id}/content"].get.responses["200"].content[
        "text/plain"
      ].schema.type,
    ).toBe("string");
  });
});
