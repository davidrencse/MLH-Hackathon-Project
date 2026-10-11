import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
afterEach(() => vi.unstubAllGlobals());
describe("library shared-context API", () => {
  it("connects a library building and passes selected saved notes into an agent task", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ghostgrid-library-api-"));
    const { app } = await buildApp({
      config: loadConfig({ GHOSTGRID_DATA_DIR: directory }),
      logger: false,
    });
    const request = async (
      method: "GET" | "POST" | "PUT" | "DELETE",
      url: string,
      payload?: unknown,
    ) => app.inject({ method, url, ...(payload ? { payload } : {}) });
    try {
      const project = (
        await request("POST", "/api/v1/projects", { name: "Shared research" })
      ).json();
      const connect = await request(
        "PUT",
        `/api/v1/projects/${project.id}/library`,
        { baseUrl: "http://127.0.0.1:8765", buildingId: "research-library" },
      );
      expect(connect.statusCode).toBe(200);
      expect(connect.json().repositoryUrl).toBe(
        "https://github.com/davidrencse/news",
      );
      expect(
        (await request("GET", `/api/v1/projects/${project.id}`)).json()
          .workspace,
      ).toBeUndefined();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                notes: "Selected research context",
                summary: "A persisted reading summary",
                highlights: [],
              }),
            ),
        ),
      );
      const spec = (await request("GET", "/api/v1/openapi.json")).json();
      const notesOperation = spec.paths["/api/v1/projects/{id}/library/articles/{articleId}/notes"].get;
      expect(notesOperation.parameters.find((parameter: any) => parameter.name === "articleId").schema).toMatchObject({ pattern: "^[A-Za-z0-9_-]{1,100}$" });
      expect(notesOperation.responses["200"].content["application/json"].schema.$ref).toBeUndefined();
      expect(notesOperation.responses["502"]).toBeDefined();
      const notesResponse = await request("GET", `/api/v1/projects/${project.id}/library/articles/article123/notes`);
      expect(notesResponse.statusCode).toBe(200);
      expect(notesResponse.json().notes).toBe("Selected research context");
      expect(spec.paths["/api/v1/projects/{id}/library"].get.responses["200"].content["application/json"].schema.properties.connection).toBeDefined();
      const context = await request(
        "POST",
        `/api/v1/projects/${project.id}/library/context`,
        { articleId: "article123", title: "Saved research" },
      );
      expect(context.statusCode).toBe(201);
      expect(context.json().source.articleId).toBe("article123");
      const provider = (
        await request("POST", "/api/v1/providers", {
          type: "mock",
          name: "Research model",
        })
      ).json();
      expect(
        (
          await request("POST", "/api/v1/agents", {
            name: "Duplicate building",
            projectId: project.id,
            providerId: provider.id,
            buildingId: "research-library",
          })
        ).statusCode,
      ).toBe(409);
      const agent = (
        await request("POST", "/api/v1/agents", {
          name: "Research assistant",
          projectId: project.id,
          providerId: provider.id,
          buildingId: "research-agent",
        })
      ).json();
      const task = (
        await request("POST", "/api/v1/tasks", {
          projectId: project.id,
          agentId: agent.id,
          prompt: "Summarize the selected notes",
          contextIds: [context.json().id],
        })
      ).json();
      let result: any;
      for (let attempt = 0; attempt < 100; attempt++) {
        result = (await request("GET", `/api/v1/tasks/${task.id}`)).json();
        if (["completed", "failed"].includes(result.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(result.status).toBe("completed");
      expect(result.result).toContain("Selected research context");
      expect(
        (
          await request(
            "POST",
            `/api/v1/projects/${project.id}/library/context`,
            { articleId: "a", paperId: "b" },
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await request(
            "GET",
            `/api/v1/projects/${project.id}/library/catalog?url=https://example.com`,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (await request("DELETE", `/api/v1/projects/${project.id}/library`))
          .statusCode,
      ).toBe(204);
      expect(
        (await request("GET", `/api/v1/projects/${project.id}/library`)).json()
          .connection,
      ).toBeNull();
      expect(
        (await request("GET", `/api/v1/projects/${project.id}/context`)).json()
          .items[0].id,
      ).toBe(context.json().id);
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
