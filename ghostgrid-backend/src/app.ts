import { ProviderCredits } from "./providers/credits.js";
import Fastify, { type FastifyInstance, type HTTPMethods } from "fastify";
import { z, ZodError } from "zod";
import { readFile } from "node:fs/promises";
import { Store, type Entity } from "./db/store.js";
import { loadConfig, type Config } from "./config.js";
import {
  validateWorkspace,
  redact,
  tokenMatches,
  safePath,
  registerSecret,
} from "./security/index.js";
import { ProviderRegistry } from "./providers/registry.js";
import { BROWSER_PROVIDER_TYPES } from "./providers/browser-session.js";
import { Engine } from "./execution/engine.js";
import { SessionService } from "./sessions/service.js";
import { createOfficeLauncher, type OfficeLauncher } from "./office/launcher.js";
import { createOpenApi, registerOperation } from "./openapi.js";
import { LibraryService, libraryConnectionSchema } from "./library/service.js";
import {
  providerSchema,
  projectSchema,
  agentSchema,
  sessionSchema,
  taskSchema,
  workflowSchema,
  contextSchema,
  listSchema,
  cursorSchema,
  eventQuerySchema,
  messageSchema,
} from "./api-schemas.js";

function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
const requireRecord = (store: Store, table: string, id: string): Entity =>
  store.get(table, id) ?? fail(404, `${table} record not found`);
export async function buildApp(
  options: {
    config?: Config;
    store?: Store;
    registry?: ProviderRegistry;
    startWorker?: boolean;
    logger?: boolean;
    officeLauncher?: OfficeLauncher;
  } = {},
) {
  const config = options.config ?? loadConfig();
  const store = options.store ?? new Store(config.databasePath);
  const registry = options.registry ?? new ProviderRegistry();
  const providerCredits = new ProviderCredits();
  registerSecret(config.apiToken);
  const registerProviderSecrets = (provider: Entity | Record<string, any>) => {
    registerSecret(process.env[provider.apiKeyEnv]);
    for (const reference of Object.values(provider.headersEnv ?? {}))
      registerSecret(process.env[String(reference)]);
  };
  for (const provider of store.list("providers"))
    registerProviderSecrets(provider);
  const engine = new Engine(store, registry, {
    concurrency: config.concurrency,
    providerConcurrency: config.providerConcurrency,
    taskTimeoutMs: config.taskTimeoutMs,
    maxRetries: config.maxRetries,
    artifactsDir: config.artifactsDir,
    allowedWorkspaces: config.allowedWorkspaces,
  });
  const sessions = new SessionService(store, engine);
  const officeLauncher = options.officeLauncher ?? createOfficeLauncher(config.allowedWorkspaces);
  const library = new LibraryService(store, (event) =>
    engine.publishEvent(event),
  );
  const app = Fastify({
    bodyLimit: 1_000_000,
    logger:
      options.logger === false
        ? false
        : {
            level: "info",
            redact: ["req.headers.authorization", "req.headers.cookie"],
            serializers: {
              req(req) {
                return {
                  method: req.method,
                  url: req.url.split("?")[0],
                  id: req.id,
                };
              },
              err(err) {
                return redact({
                  message: err.message,
                  type: err.name,
                  stack: "",
                });
              },
            },
          },
  });
  const spec = createOpenApi(config.apiToken);
  const streams = new Set<() => void>();
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "no-store");
    // Origin alone cannot protect a tokenless loopback service from DNS
    // rebinding: same-origin GETs may omit it. Check the actual Host header.
    if (
      !config.apiToken &&
      !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(
        req.headers.host ?? "",
      )
    )
      fail(403, "Tokenless requests require a loopback Host header");
    const origin = req.headers.origin;
    if (origin) {
      if (!(config.allowedOrigins ?? []).includes(origin))
        fail(403, "Browser origin is not allowed");
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      if (req.method === "OPTIONS") {
        reply.header(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        );
        reply.header(
          "Access-Control-Allow-Headers",
          "authorization,content-type,last-event-id",
        );
        reply.header("Access-Control-Max-Age", "600");
        return reply.code(204).send();
      }
    }
    if (
      config.apiToken &&
      !tokenMatches(
        req.headers.authorization ?? "",
        `Bearer ${config.apiToken}`,
      )
    )
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid bearer token is required",
          requestId: req.id,
        },
      });
  });
  app.options("/*", async (_req, reply) => reply.code(204).send());
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: req.id,
      },
    }),
  );
  app.setErrorHandler((error, req, reply) => {
    const candidate = error as Error & {
      statusCode?: number;
      code?: string;
      errcode?: number;
    };
    const status =
      error instanceof ZodError
        ? 400
        : (candidate.statusCode ??
          (candidate.errcode !== undefined && (candidate.errcode & 255) === 19
            ? 409
            : 500));
    const message =
      error instanceof ZodError
        ? error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : status >= 500
          ? "Internal server error"
          : candidate.message;
    if (status >= 500) app.log.error({ err: candidate }, "Request failed");
    reply.code(status).send(
      redact({
        error: {
          code:
            status === 400
              ? "VALIDATION_ERROR"
              : status === 404
                ? "NOT_FOUND"
                : status === 409
                  ? "CONFLICT"
                  : status === 403
                    ? "FORBIDDEN"
                    : "REQUEST_ERROR",
          message,
          requestId: req.id,
        },
      }),
    );
  });
  function route(
    method: HTTPMethods,
    url: string,
    handler: Parameters<FastifyInstance["route"]>[0]["handler"],
    body?: z.ZodType,
  ) {
    registerOperation(spec, method, url, body);
    const pathShape = Object.fromEntries(
      [...url.matchAll(/:([\w]+)/g)].map((match) => [
        match[1],
        match[1] === "articleId"
          ? z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
          : z.string().uuid(),
      ]),
    );
    app.route({
      method,
      url,
      handler,
      preValidation: async (req) => {
        z.object(pathShape).strict().parse(req.params);
      },
    });
  }
  route("GET", "/health", async () => ({ status: "ok" }));
  route("GET", "/api/v1/status", async () => ({
    status: "ok",
    version: "0.1.0",
    workerConcurrency: config.concurrency,
    storage: "sqlite",
    codingIsolation: "git-worktrees",
    resources: "operational-usage",
  }));
  route("GET", "/api/v1/openapi.json", async () => spec);
  app.get("/docs", async () => ({
    openapi: "/api/v1/openapi.json",
    guide: "See README.md; this backend has no frontend",
  }));
  function validateEntity(table: string, data: Record<string, any>) {
    if (data.workspace)
      data.workspace = validateWorkspace(
        data.workspace,
        config.allowedWorkspaces,
      );
    if (table === "providers") {
      registerProviderSecrets(data);
      if (data.auth === "header" && !data.apiKeyHeader)
        fail(400, "Header authentication requires apiKeyHeader");
      if (
        [data.apiKeyHeader, ...Object.keys(data.headersEnv ?? {})].some(
          (k) =>
            k &&
            /^(host|content-length|transfer-encoding|connection|content-type)$/i.test(
              k,
            ),
        )
      )
        fail(400, "Transport headers cannot be configured");
      if (
        Object.keys(data.queryParameters ?? {}).some((k) =>
          /(key|token|secret|password|credential|authorization)/i.test(k),
        )
      )
        fail(400, "Credentials must be environment-referenced headers");
      if (["deepseek", "openai-compatible"].includes(data.type) && !data.model)
        fail(400, "Inference providers require a model identifier");
      if (data.type === "deepseek" && !data.baseUrl)
        data.baseUrl = "https://api.deepseek.com";
      if (data.type === "openai-compatible" && !data.baseUrl)
        fail(400, "OpenAI-compatible providers require baseUrl");
      if (BROWSER_PROVIDER_TYPES.includes(data.type)) {
        // Browser-hosted sessions reach the signed-in site through a local Chrome
        // DevTools endpoint; no credentials are configured or stored for them.
        if (!data.baseUrl) data.baseUrl = "http://127.0.0.1:9222";
        if (
          data.apiKeyEnv ||
          data.apiKeyHeader ||
          Object.keys(data.headersEnv ?? {}).length ||
          Object.keys(data.queryParameters ?? {}).length
        )
          fail(
            400,
            "Browser-hosted sessions authenticate through the signed-in browser profile, not configured credentials",
          );
        data.auth = "none";
        const endpoint = new URL(data.baseUrl);
        if (
          endpoint.protocol !== "http:" ||
          !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
          endpoint.pathname !== "/"
        )
          fail(
            400,
            "Browser-hosted sessions require a loopback Chrome DevTools endpoint, for example http://127.0.0.1:9222",
          );
      }
      if (data.baseUrl) {
        const u = new URL(data.baseUrl);
        if (u.username || u.password || u.search || u.hash)
          fail(
            400,
            "Base URLs cannot contain credentials, query strings, or fragments",
          );
        if (
          u.protocol !== "https:" &&
          !(
            u.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
          )
        )
          fail(400, "Use HTTPS, or loopback HTTP for a local model");
      }
      if (
        ["deepseek", "openai-compatible"].includes(data.type) &&
        data.auth !== "none" &&
        !data.apiKeyEnv
      )
        fail(
          400,
          "Bearer authentication requires apiKeyEnv; credentials remain in the environment",
        );
    }
    if (table === "agents") {
      const project = requireRecord(store, "projects", data.projectId);
      if (data.buildingId && project.library?.buildingId === data.buildingId)
        fail(409, "This building belongs to the project library");
      if (
        data.buildingId &&
        store
          .list("agents", {
            projectId: data.projectId,
            buildingId: data.buildingId,
          })
          .some((a) => a.id !== data.id)
      )
        fail(
          409,
          "This building already has an agent; use its session manager",
        );
      requireRecord(store, "providers", data.providerId);
      if (data.workspace && data.workspace !== project.workspace)
        fail(400, "Agent workspace must match its project workspace");
      if (data.permissions.includes("write") && !project.workspace)
        fail(400, "Write agents require a project workspace");
    }
    return data;
  }
  function entityIdentifiers(table: string, record: Entity) {
    return table === "agents"
      ? { agentId: record.id, projectId: record.projectId }
      : table === "projects"
        ? { projectId: record.id }
        : { providerId: record.id };
  }
  for (const [table, schema] of [
    ["providers", providerSchema],
    ["projects", projectSchema],
    ["agents", agentSchema],
  ] as const) {
    const url = `/api/v1/${table}`;
    route(
      "POST",
      url,
      async (req, reply) => {
        const body = validateEntity(table, schema.parse(req.body));
        const { record, event } = store.transaction(() => {
          const record = store.insert(
            table,
            table === "providers" ? body : redact(body),
          );
          const event = store.event(
            `${table.slice(0, -1)}.created`,
            null,
            { id: record.id },
            entityIdentifiers(table, record),
          );
          return { record, event };
        });
        engine.publishEvent(event);
        return reply.code(201).send(redact(record));
      },
      schema,
    );
    route("GET", url, async (req) => {
      const { limit, offset, ...filters } = listSchema.parse(req.query);
      const { items, total } = store.page(table, filters, { limit, offset });
      return redact({
        items: items.map((record) =>
          table === "providers"
            ? {
                ...record,
                capabilities: registry.get(record as any).getCapabilities(),
              }
            : record,
        ),
        total,
      });
    });
    route("GET", `${url}/:id`, async (req) => {
      const record = requireRecord(
        store,
        table,
        (req.params as { id: string }).id,
      );
      return redact(
        table === "providers"
          ? {
              ...record,
              capabilities: registry.get(record as any).getCapabilities(),
            }
          : record,
      );
    });
    route(
      "PATCH",
      `${url}/:id`,
      async (req) => {
        const id = (req.params as { id: string }).id;
        const previous = requireRecord(store, table, id);
        const patch = schema.partial().parse(req.body);
        const supplied = Object.fromEntries(
          Object.entries(patch).filter(([k]) =>
            Object.hasOwn(req.body as object, k),
          ),
        );
        const related =
          table === "providers"
            ? store.list("agents", { providerId: id }).map((a) => a.id)
            : table === "projects"
              ? store.list("agents", { projectId: id }).map((a) => a.id)
              : [id];
        if (
          store
            .list("tasks")
            .some(
              (t) =>
                related.includes(t.agentId) &&
                ["pending", "queued", "running", "awaiting_approval"].includes(
                  t.status,
                ),
            )
        )
          fail(
            409,
            "Configuration cannot change while related tasks are active",
          );
        if (
          (supplied.projectId && supplied.projectId !== previous.projectId) ||
          (supplied.providerId && supplied.providerId !== previous.providerId)
        )
          fail(409, "Create a new agent to change its project or provider");
        if (
          table === "providers" &&
          supplied.type &&
          supplied.type !== previous.type &&
          store.list("agents", { providerId: id }).length
        )
          fail(409, "Provider type cannot change once agents exist");
        if (
          table === "projects" &&
          supplied.workspace &&
          supplied.workspace !== previous.workspace &&
          store.list("agents", { projectId: id }).length
        )
          fail(409, "Project workspace cannot change once agents exist");
        const merged = validateEntity(table, { ...previous, ...supplied });
        const { record, event } = store.transaction(() => {
          const record = store.update(
            table,
            id,
            table === "providers" ? merged : redact(merged),
          );
          const event = store.event(
            `${table.slice(0, -1)}.updated`,
            null,
            { id, changedFields: Object.keys(supplied) },
            entityIdentifiers(table, record),
          );
          return { record, event };
        });
        engine.publishEvent(event);
        return redact(record);
      },
      schema.partial(),
    );
    route("DELETE", `${url}/:id`, async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const record = requireRecord(store, table, id);
      const event = store.transaction(() => {
        store.delete(table, id);
        return store.event(
          `${table.slice(0, -1)}.deleted`,
          null,
          { id },
          entityIdentifiers(table, record),
        );
      });
      engine.publishEvent(event);
      return reply.code(204).send();
    });
  }
  route("POST", "/api/v1/providers/:id/test", async (req) => {
    const provider = requireRecord(
      store,
      "providers",
      (req.params as { id: string }).id,
    );
    const adapter = registry.get(provider as any);
    const availability = await adapter.checkAvailability();
    store.update("providers", provider.id, {
      availability,
      checkedAt: new Date().toISOString(),
    });
    return redact({ ...availability, capabilities: adapter.getCapabilities() });
  });
  route(
    "POST",
    "/api/v1/sessions",
    async (req, reply) =>
      reply
        .code(201)
        .send(redact(sessions.create(sessionSchema.parse(req.body)))),
    sessionSchema,
  );
  for (const table of ["sessions", "tasks", "workflows"] as const) {
    route("GET", `/api/v1/${table}`, async (req) => {
      const { limit, offset, ...filters } = listSchema.parse(req.query);
      const { items: page, total } = store.page(table, filters, {
        limit,
        offset,
      });
      return redact({
        items: table === "sessions" ? sessions.describeMany(page) : page,
        total,
      });
    });
    route("GET", `/api/v1/${table}/:id`, async (req) => {
      const record = requireRecord(
        store,
        table,
        (req.params as { id: string }).id,
      );
      return redact(
        table === "workflows"
          ? {
              ...record,
              nodes: store.list("workflow_nodes", { workflowId: record.id }),
            }
          : table === "sessions"
            ? sessions.get(record.id)
            : {
                ...record,
                dependencies: store
                  .list("task_dependencies", { taskId: record.id })
                  .map((d) => d.dependsOnTaskId),
              },
      );
    });
  }
  route("GET", "/api/v1/office/options", async () => ({
    ...officeLauncher.available(),
    workspaces: config.allowedWorkspaces,
  }));
  route("GET", "/api/v1/office/workers", async (req) => {
    const query = z.object({ buildingId: z.string().min(1).max(160), projectId: z.string().uuid() }).strict().parse(req.query);
    requireRecord(store, "projects", query.projectId);
    return { items: store.list("sessions", { projectId: query.projectId, status: "active" })
      .filter((session) => session.officeWorker?.buildingId === query.buildingId)
      .map((session) => ({ id: session.id, name: session.name, ...session.officeWorker })) };
  });
  const officeWorkerSchema = z.object({
    projectId: z.string().uuid(),
    buildingId: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(80),
    runtime: z.enum(["codex", "claude", "chatgpt-browser", "claude-browser"]),
    workspace: z.string().min(1).optional(),
  }).strict();
  route("POST", "/api/v1/office/workers", async (req, reply) => {
    const body = officeWorkerSchema.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    const building = store.list("agents", { projectId: body.projectId, buildingId: body.buildingId })[0];
    if (!building) fail(404, "Office building not found");
    // Launch before recording the desk: a failed native launch must never look successful.
    const launched = await officeLauncher.launch(body.runtime, body.workspace);
    const session = sessions.create({ projectId: body.projectId, agentId: building.id, name: body.name });
    const officeWorker = { buildingId: body.buildingId, runtime: body.runtime, workspace: body.workspace,
      openedAt: new Date().toISOString(), pid: launched.pid };
    store.update("sessions", session.id, { officeWorker });
    return reply.code(201).send({ id: session.id, name: body.name, ...officeWorker });
  }, officeWorkerSchema);
  route("POST", "/api/v1/office/workers/:id/open", async (req) => {
    const session = requireRecord(store, "sessions", (req.params as { id: string }).id);
    if (!session.officeWorker || session.status !== "active") fail(404, "Office worker not found");
    const { runtime, workspace } = session.officeWorker;
    await officeLauncher.launch(runtime, workspace);
    return { opened: true };
  });
  route("DELETE", "/api/v1/office/workers/:id", async (req, reply) => {
    const session = requireRecord(store, "sessions", (req.params as { id: string }).id);
    if (!session.officeWorker) fail(404, "Office worker not found");
    sessions.update(session.id, { status: "archived" });
    // Removing a desk does not terminate independently opened native applications.
    return reply.code(204).send();
  });
  const sessionPatch = z
    .object({
      name: z.string().trim().min(1).max(160).optional(),
      status: z.enum(["active", "archived"]).optional(),
      memory: z.string().max(16_000).optional(),
    })
    .strict();
  route(
    "PATCH",
    "/api/v1/sessions/:id",
    async (req) =>
      redact(
        sessions.update(
          (req.params as { id: string }).id,
          sessionPatch.parse(req.body),
        ),
      ),
    sessionPatch,
  );
  route("POST", "/api/v1/sessions/:id/resume", async (req) =>
    redact(sessions.resume((req.params as { id: string }).id)),
  );
  route("POST", "/api/v1/sessions/:id/cancel", async (req) =>
    redact(sessions.cancel((req.params as { id: string }).id)),
  );
  route("GET", "/api/v1/agents/:id/sessions", async (req) =>
    redact({ items: sessions.list((req.params as { id: string }).id) }),
  );
  const buildingSession = z
    .object({ name: z.string().trim().min(1).max(160).default("New session") })
    .strict();
  route(
    "POST",
    "/api/v1/agents/:id/sessions",
    async (req, reply) => {
      const agent = requireRecord(
        store,
        "agents",
        (req.params as { id: string }).id,
      );
      const body = buildingSession.parse(req.body ?? {});
      return reply.code(201).send(
        redact(
          sessions.create({
            ...body,
            projectId: agent.projectId,
            agentId: agent.id,
          }),
        ),
      );
    },
    buildingSession,
  );
  route("GET", "/api/v1/sessions/:id/tasks", async (req) => {
    const id = (req.params as { id: string }).id;
    requireRecord(store, "sessions", id);
    return redact({ items: store.list("tasks", { sessionId: id }) });
  });
  route("GET", "/api/v1/sessions/:id/events", async (req) => {
    const id = (req.params as { id: string }).id;
    requireRecord(store, "sessions", id);
    const { after, limit } = cursorSchema.parse(req.query);
    return redact(eventPage(after ?? 0, limit, { sessionId: id }));
  });
  function eventPage(
    after: number,
    limit: number,
    filters: Record<string, string | undefined>,
  ) {
    const items = store.events(after, filters.taskId, limit, filters);
    return { items, nextCursor: items.at(-1)?.seq ?? after };
  }
  route("GET", "/api/v1/events", async (req) => {
    const { after, limit, ...filters } = eventQuerySchema.parse(req.query);
    return redact(eventPage(after ?? 0, limit, filters));
  });
  route(
    "POST",
    "/api/v1/sessions/:id/messages",
    async (req, reply) => {
      const session = requireRecord(
        store,
        "sessions",
        (req.params as { id: string }).id,
      );
      const body = messageSchema.parse(req.body);
      if (session.officeWorker) fail(409, "This worker uses an external window. Send messages in its native application.");
      return reply.code(202).send(
        redact(
          engine.submitTask({
            ...body,
            projectId: session.projectId,
            agentId: session.agentId,
            sessionId: session.id,
          }),
        ),
      );
    },
    messageSchema,
  );
  route(
    "POST",
    "/api/v1/tasks",
    async (req, reply) =>
      reply
        .code(202)
        .send(redact(engine.submitTask(taskSchema.parse(req.body)))),
    taskSchema,
  );
  route("POST", "/api/v1/tasks/:id/cancel", async (req) =>
    redact(engine.cancelTask((req.params as { id: string }).id)),
  );
  route("GET", "/api/v1/tasks/:id/events", async (req) => {
    const id = (req.params as { id: string }).id;
    requireRecord(store, "tasks", id);
    const { after, limit } = cursorSchema.parse(req.query);
    return redact(eventPage(after ?? 0, limit, { taskId: id }));
  });
  route("GET", "/api/v1/tasks/:id/artifacts", async (req) => {
    const id = (req.params as { id: string }).id;
    requireRecord(store, "tasks", id);
    return redact({ items: store.list("artifacts", { taskId: id }) });
  });
  route("GET", "/api/v1/artifacts/:id/content", async (req, reply) => {
    const artifact = requireRecord(
      store,
      "artifacts",
      (req.params as { id: string }).id,
    );
    const path = safePath(
      config.artifactsDir,
      artifact.path ?? artifact.relativePath,
    );
    reply.type("text/plain; charset=utf-8");
    return redact(await readFile(path, "utf8"));
  });
  route(
    "POST",
    "/api/v1/workflows",
    async (req, reply) =>
      reply
        .code(201)
        .send(redact(engine.createWorkflow(workflowSchema.parse(req.body)))),
    workflowSchema,
  );
  route("POST", "/api/v1/workflows/:id/run", async (req) =>
    redact(engine.runWorkflow((req.params as { id: string }).id)),
  );
  route("POST", "/api/v1/workflows/:id/cancel", async (req) =>
    redact(engine.cancelWorkflow((req.params as { id: string }).id)),
  );
  route(
    "POST",
    "/api/v1/projects/:id/context",
    async (req, reply) => {
      const projectId = (req.params as { id: string }).id;
      const project = requireRecord(store, "projects", projectId);
      const body = contextSchema.parse(req.body);
      if (
        body.sourceTaskId &&
        requireRecord(store, "tasks", body.sourceTaskId).projectId !== projectId
      )
        fail(400, "Context task belongs to another project");
      if (
        body.agentId &&
        requireRecord(store, "agents", body.agentId).projectId !== projectId
      )
        fail(400, "Context agent belongs to another project");
      if (body.fileReference) {
        if (!project.workspace)
          fail(400, "File references require a workspace");
        safePath(project.workspace, body.fileReference);
      }
      const { entry, event } = store.transaction(() => {
        const entry = store.insert(
          "context_entries",
          redact({
            ...body,
            projectId,
            taskId: body.sourceTaskId ?? null,
          }),
        );
        const event = store.event(
          "context.created",
          null,
          { id: entry.id },
          {
            projectId,
            ...(body.agentId ? { agentId: body.agentId } : {}),
          },
        );
        return { entry, event };
      });
      engine.publishEvent(event);
      return reply.code(201).send(redact(entry));
    },
    contextSchema,
  );
  route("GET", "/api/v1/projects/:id/context", async (req) => {
    const projectId = (req.params as { id: string }).id;
    requireRecord(store, "projects", projectId);
    return redact({ items: store.list("context_entries", { projectId }) });
  });
  route(
    "PUT",
    "/api/v1/projects/:id/library",
    async (req) =>
      redact(library.connect((req.params as { id: string }).id, req.body)),
    libraryConnectionSchema,
  );
  route("GET", "/api/v1/projects/:id/library", async (req) =>
    redact({ connection: library.get((req.params as { id: string }).id) }),
  );
  route("DELETE", "/api/v1/projects/:id/library", async (req, reply) => {
    library.disconnect((req.params as { id: string }).id);
    return reply.code(204).send();
  });
  for (const operation of [
    "catalog",
    "search",
    "papers",
    "notebook",
  ] as const) {
    route("GET", `/api/v1/projects/:id/library/${operation}`, async (req) =>
      redact(
        await library.request(
          (req.params as { id: string }).id,
          operation,
          req.query as Record<string, unknown>,
        ),
      ),
    );
  }
  route("GET", "/api/v1/projects/:id/library/status", async (req) => {
    const payload = await library.request(
      (req.params as { id: string }).id,
      "status",
      req.query as Record<string, unknown>,
    );
    return {
      available: true,
      readOnly: true,
      repositoryUrl: "https://github.com/davidrencse/news",
      catalogVersion: payload.version ?? null,
      checkedAt: new Date().toISOString(),
    };
  });
  route(
    "GET",
    "/api/v1/projects/:id/library/articles/:articleId/notes",
    async (req) => {
      const params = req.params as { id: string; articleId: string };
      return redact(
        await library.request(
          params.id,
          "notes",
          req.query as Record<string, unknown>,
          params.articleId,
        ),
      );
    },
  );
  const libraryContext = z
    .object({
      articleId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,100}$/)
        .optional(),
      paperId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,100}$/)
        .optional(),
      title: z.string().trim().min(1).max(160).optional(),
    })
    .strict()
    .refine(
      (body) => Boolean(body.articleId) !== Boolean(body.paperId),
      "Select exactly one article or paper",
    );
  route(
    "POST",
    "/api/v1/projects/:id/library/context",
    async (req, reply) =>
      reply
        .code(201)
        .send(
          redact(
            await library.importContext(
              (req.params as { id: string }).id,
              libraryContext.parse(req.body),
            ),
          ),
        ),
    libraryContext,
  );
  route("GET", "/api/v1/provider-credits", async (req) => {
    const { refresh } = z.object({ refresh: z.enum(["0", "1"]).optional() }).strict().parse(req.query);
    return providerCredits.read(refresh === "1");
  });
  route("GET", "/api/v1/usage/summary", async (req) => {
    const { projectId } = z.object({ projectId: z.string().uuid().optional() }).strict().parse(req.query);
    if (projectId) requireRecord(store, "projects", projectId);
    return store.usageSummary(projectId);
  });
  route("GET", "/api/v1/usage", async (req) => {
    const { limit, offset, projectId, agentId } = listSchema.parse(req.query);
    return redact(store.usagePage({ projectId, agentId }, limit, offset));
  });
  route("GET", "/api/v1/metrics", async (req) => {
    const { limit, offset } = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().nonnegative().default(0),
      })
      .strict()
      .parse(req.query);
    const metrics = store.metrics(limit, offset);
    return redact({
      ...metrics,
      capacity: {
        concurrency: config.concurrency,
        inUse: metrics.tasks.running,
        utilization: metrics.tasks.running / config.concurrency,
      },
      providers: store
        .list("providers")
        .map((p) => ({ id: p.id, availability: p.availability ?? null })),
    });
  });
  route("GET", "/api/v1/events/stream", async (req, reply) => {
    const q = z
      .object({
        after: z.coerce.number().int().nonnegative().optional(),
        taskId: z.string().uuid().optional(),
        sessionId: z.string().uuid().optional(),
        agentId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.query);
    let cursor = q.after ?? 0;
    const last = req.headers["last-event-id"];
    if (last) {
      if (/^\d+$/.test(String(last))) cursor = Number(last);
      else {
        const event = store.get("execution_events", String(last));
        if (!event) fail(400, "Unknown Last-Event-ID");
        cursor = event.seq;
      }
    }
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      fail(400, "Invalid event cursor");
    if (q.taskId) requireRecord(store, "tasks", q.taskId);
    if (q.sessionId) requireRecord(store, "sessions", q.sessionId);
    if (q.agentId) requireRecord(store, "agents", q.agentId);
    if (q.projectId) requireRecord(store, "projects", q.projectId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(req.headers.origin
        ? { "Access-Control-Allow-Origin": req.headers.origin, Vary: "Origin" }
        : {}),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let closed = false;
    // write() returning false only means the socket buffer is full. Stop sending
    // until it drains instead of dropping a healthy client mid-stream.
    let draining = false;
    let polling: ReturnType<typeof setInterval>;
    let heartbeat: ReturnType<typeof setInterval>;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(polling);
      clearInterval(heartbeat);
      streams.delete(close);
      res.end();
    };
    const send = (frame: string) => {
      if (res.write(frame)) return true;
      draining = true;
      res.once("drain", () => {
        draining = false;
      });
      return false;
    };
    const poll = () => {
      if (closed || draining) return;
      const page = eventPage(cursor, 500, {
        taskId: q.taskId,
        sessionId: q.sessionId,
        agentId: q.agentId,
        projectId: q.projectId,
      });
      for (const event of page.items) {
        // Buffered frames are still delivered, so the cursor advances either way.
        cursor = event.seq;
        if (
          !send(
            `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(redact(event))}\n\n`,
          )
        )
          break;
      }
      if (!closed && !draining) cursor = page.nextCursor;
    };
    streams.add(close);
    res.on("close", close);
    res.on("error", close);
    polling = setInterval(poll, 250);
    heartbeat = setInterval(() => {
      if (!closed && !draining) send(": heartbeat\n\n");
    }, 15000);
    send(": connected\n\n");
    poll();
  });
  app.addHook("preClose", async () => {
    for (const close of streams) close();
    await engine.stop();
  });
  app.addHook("onClose", async () => {
    store.close();
  });
  if (options.startWorker !== false) engine.start();
  return { app, store, engine, sessions, library, registry, config };
}
