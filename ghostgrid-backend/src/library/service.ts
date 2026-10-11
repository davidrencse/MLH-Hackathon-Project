import { z } from "zod";
import type { Store, Entity } from "../db/store.js";
import { redact, registerSecret } from "../security/index.js";

export const libraryRepositoryUrl = "https://github.com/davidrencse/news";
const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const libraryConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(200).default("Library of Babel"),
    buildingId: identifier.default("library"),
    baseUrl: z
      .string()
      .url()
      .superRefine((value, ctx) => {
        const url = new URL(value);
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !(
            ["https:"].includes(url.protocol) ||
            (url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          )
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Use HTTPS or loopback HTTP without URL credentials, query or fragment",
          });
      }),
    apiKeyEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
    timeoutMs: z.number().int().min(1).max(60000).default(10000),
  })
  .strict();
export type LibraryConnection = z.infer<typeof libraryConnectionSchema>;
export type LibraryOperation =
  "catalog" | "search" | "papers" | "notebook" | "notes" | "status";
const catalogQuery = z
  .object({
    offset: z.coerce.number().int().min(0).max(1000000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    topic_id: identifier.optional(),
    subtopic_id: identifier.optional(),
    access: z.enum(["all", "free", "locked"]).optional(),
  })
  .strict()
  .refine(
    (q) => !q.subtopic_id || !!q.topic_id,
    "A topic is required with a subtopic",
  );
const searchQuery = z
  .object({
    q: z.string().max(1000),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export class LibraryService {
  constructor(
    private store: Store,
    private publishEvent: (event: Entity) => void = () => {},
  ) {}
  private project(id: string) {
    const project = this.store.get("projects", id);
    if (!project) throw fail("Project not found", 404);
    return project;
  }
  connect(projectId: string, input: unknown) {
    const project = this.project(projectId);
    const config = libraryConnectionSchema.parse(input);
    if (
      this.store
        .list("agents", { projectId })
        .some((agent) => (agent.buildingId ?? agent.id) === config.buildingId)
    )
      throw fail("Library building ID is already assigned to an agent", 409);
    const { connection, event } = this.store.transaction(() => {
      const connection = this.store.update("projects", projectId, {
        library: {
          ...config,
          repositoryUrl: libraryRepositoryUrl,
          connectedAt: new Date().toISOString(),
        },
      }).library;
      const event = this.store.event(
        "library.connected",
        null,
        redact({
          name: config.name,
          repositoryUrl: libraryRepositoryUrl,
        }),
        { projectId, buildingId: config.buildingId },
      );
      return { connection, event };
    });
    this.publishEvent(event);
    return connection;
  }
  get(projectId: string) {
    return this.project(projectId).library ?? null;
  }
  disconnect(projectId: string) {
    const connection = this.get(projectId);
    if (!connection) return { disconnected: true };
    const event = this.store.transaction(() => {
      this.store.update("projects", projectId, { library: null });
      return this.store.event(
        "library.disconnected",
        null,
        {
          repositoryUrl: libraryRepositoryUrl,
        },
        { projectId, buildingId: connection.buildingId },
      );
    });
    this.publishEvent(event);
    return { disconnected: true };
  }
  async request(
    projectId: string,
    operation: LibraryOperation,
    query: Record<string, unknown> = {},
    articleId?: string,
  ): Promise<any> {
    const saved = this.get(projectId);
    if (!saved) throw fail("Project library is not connected", 409);
    const config = libraryConnectionSchema.parse({
      name: saved.name,
      buildingId: saved.buildingId,
      baseUrl: saved.baseUrl,
      apiKeyEnv: saved.apiKeyEnv,
      timeoutMs: saved.timeoutMs,
    });
    let path: string;
    let params: Record<string, unknown> = {};
    switch (operation) {
      case "catalog":
        path = "/api/library/page";
        params = catalogQuery.parse(query);
        break;
      case "search":
        path = "/api/library/search";
        params = searchQuery.parse(query);
        break;
      case "papers":
        path = "/api/papers";
        z.object({}).strict().parse(query);
        break;
      case "notebook":
        path = "/api/notebook";
        z.object({}).strict().parse(query);
        break;
      case "notes":
        path = `/api/articles/${identifier.parse(articleId)}/notes`;
        z.object({}).strict().parse(query);
        break;
      case "status":
        path = "/api/library/first";
        params = { limit: 1 };
        z.object({}).strict().parse(query);
        break;
      default:
        throw fail("Unsupported read-only library operation");
    }
    const url = new URL(config.baseUrl);
    url.pathname = url.pathname.replace(/\/$/, "") + path;
    for (const [key, value] of Object.entries(params))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.apiKeyEnv) {
      const key = process.env[config.apiKeyEnv];
      if (!key)
        throw fail(
          `Missing library credential environment variable: ${config.apiKeyEnv}`,
          503,
        );
      registerSecret(key);
      headers.Authorization = `Bearer ${key}`;
    }
    const signal = AbortSignal.timeout(config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal,
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw fail(`Library returned HTTP ${response.status}`, 502);
      }
      const max = 2 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > max) {
        await response.body?.cancel();
        throw fail("Library response exceeds the 2 MB limit", 502);
      }
      const reader = response.body?.getReader();
      if (!reader) throw fail("Library returned an empty response", 502);
      let total = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > max) {
            await reader.cancel();
            throw fail("Library response exceeds the 2 MB limit", 502);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw fail("Library returned invalid JSON", 502);
      }
      const item = z.object({ id: identifier }).loose();
      const responseSchemas = {
        notes: z
          .object({
            notes: z.string().optional(),
            summary: z.string().optional(),
            highlights: z.array(z.unknown()).optional(),
          })
          .loose(),
        papers: z
          .object({
            items: z.array(item.extend({ title: z.string().optional() })),
          })
          .loose(),
        catalog: z
          .object({
            articles: z.array(item),
            total: z.number().int().nonnegative(),
          })
          .loose(),
        search: z
          .object({
            items: z.array(item),
            total: z.number().int().nonnegative(),
          })
          .loose(),
        notebook: z
          .object({ entries: z.array(z.object({ article: item }).loose()) })
          .loose(),
        status: z
          .object({
            articles: z.array(item),
            topics: z.array(z.object({ id: identifier }).loose()),
            version: z.number().int().nonnegative(),
          })
          .loose(),
      };
      const responseSchema = responseSchemas[operation];
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success)
        throw fail("Library returned an invalid response shape", 502);
      return redact(parsed.data);
    } catch (error: any) {
      if (signal.aborted) throw fail("Library request timed out", 504);
      if (error.statusCode) throw error;
      throw fail("Could not reach the configured library", 502);
    }
  }
  async importContext(
    projectId: string,
    input: { articleId?: string; paperId?: string; title?: string },
  ) {
    this.project(projectId);
    if (!!input.articleId === !!input.paperId)
      throw fail("Select exactly one article or paper");
    let content: string;
    let title = input.title;
    let source: Record<string, unknown> = {
      integration: "news",
      repositoryUrl: libraryRepositoryUrl,
      projectId,
      buildingId: this.get(projectId)?.buildingId,
      importedAt: new Date().toISOString(),
    };
    if (input.articleId) {
      identifier.parse(input.articleId);
      const notes = await this.request(projectId, "notes", {}, input.articleId);
      const selected = {
        notes: notes.notes ?? "",
        summary: notes.summary ?? "",
        highlights: notes.highlights ?? [],
      };
      if (!selected.notes && !selected.summary && !selected.highlights.length)
        throw fail(
          "Selected article has no saved notes, summary or highlights",
          409,
        );
      content = JSON.stringify(selected);
      title ??= `Library notes: ${input.articleId}`;
      source.articleId = input.articleId;
    } else {
      identifier.parse(input.paperId);
      const papers = await this.request(projectId, "papers");
      const paper = (papers.items ?? []).find(
        (item: any) => item.id === input.paperId,
      );
      if (!paper) throw fail("Saved paper not found", 404);
      const { raw, ...metadata } = paper;
      content = JSON.stringify(metadata);
      title ??= (
        paper.title?.trim() || `Library paper: ${input.paperId}`
      ).slice(0, 160);
      source.paperId = input.paperId;
    }
    if (content.length > 100000)
      throw fail("Selected library context exceeds 100000 characters");
    if (typeof title !== "string" || !title.trim() || title.length > 160)
      throw fail("Context title must contain between 1 and 160 characters");
    const { context, event } = this.store.transaction(() => {
      const context = this.store.insert(
        "context_entries",
        redact({
          projectId,
          title,
          content,
          source,
          kind: "library",
          createdAt: new Date().toISOString(),
        }),
      );
      const event = this.store.event(
        "context.created",
        null,
        {
          contextId: context.id,
          kind: "library",
        },
        { projectId, buildingId: source.buildingId },
      );
      return { context, event };
    });
    this.publishEvent(event);
    return context;
  }
}
