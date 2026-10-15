import { ProviderCredits, withRecordedUsage, type UsageProviderRow } from "./providers/credits.js";
import { localCliUsage } from "./providers/localCliUsage.js";
import Fastify, { type FastifyInstance, type HTTPMethods } from "fastify";
import { z, ZodError } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
import { cachedCliScan } from "./office/processScan.js";
import { cliActivity } from "./office/cliActivity.js";
import { createSkillsRunner, type SkillsRunner } from "./office/skills.js";
import { createOfficeOrchestrator, type OfficeOrchestrator } from "./office/orchestrator.js";
import { assertRepoWorkspace, listRepoCandidates } from "./office/workspaces.js";
import { messageCliSession, MAX_PROMPT } from "./office/cliMessage.js";
import { createSubtaskRunner, type SubtaskRunner } from "./office/subtasks.js";
import { createStream, deleteStream, listStreams, updateStream } from "./office/streams.js";
import { assertLeadStaysPut, hireEngineer, staffStream, type StaffedStream } from "./office/staffing.js";
import { streamLog } from "./office/activityLog.js";
import {
  createRole,
  deleteRole,
  KIND_SUMMARY,
  ladderStep,
  listRoles,
  resolveRole,
  ROLE_KINDS,
  rolePresets,
  type RoleKind,
  updateRole,
} from "./office/roles.js";
import { createOpenApi, registerOperation } from "./openapi.js";
import { LibraryService, libraryConnectionSchema } from "./library/service.js";
import { WallStreetService } from "./wallstreet/service.js";
import {
  providerSchema,
  projectSchema,
  agentSchema,
  sessionSchema,
  taskSchema,
  workflowSchema,
  contextSchema,
  officeOrgFields,
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
    skillsRunner?: SkillsRunner;
    orchestrator?: OfficeOrchestrator;
    subtasks?: SubtaskRunner;
    wallStreet?: WallStreetService;
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
  // skills.sh lives beside dev.sh at the workspace root, found from this file rather than the
  // working directory so the server can be started from anywhere.
  const skillsRunner = options.skillsRunner
    ?? createSkillsRunner(process.env.GHOSTGRID_SKILLS_SCRIPT
      ?? fileURLToPath(new URL("../../skills.sh", import.meta.url)), config.allowedWorkspaces);
  // Turns a building's org chart into an engine workflow: manager plans, leads design,
  // engineers build, leads review, manager signs off.
  const orchestrator = options.orchestrator ?? createOfficeOrchestrator(store, engine);
  // One piece of work dropped into a project: the lead decides who takes it.
  const subtasks = options.subtasks ?? createSubtaskRunner(store, engine);
  const wallStreet = options.wallStreet ?? new WallStreetService();
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
        match[1] === "articleId" || match[1] === "slug"
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
  // Wall Street: the quant-bot district. Read-only public repository metadata; a GitHub outage
  // degrades to cached or static data instead of failing the city.
  route("GET", "/api/v1/wallstreet", async (req) => {
    const query = z
      .object({ refresh: z.enum(["0", "1", "true", "false"]).optional() })
      .strict()
      .parse(req.query ?? {});
    return redact(
      await wallStreet.list({
        refresh: query.refresh === "1" || query.refresh === "true",
      }),
    );
  });
  route("GET", "/api/v1/wallstreet/:slug", async (req) => {
    const slug = (req.params as { slug: string }).slug;
    const seed = wallStreet.find(slug);
    if (!seed) fail(404, "Wall Street building not found");
    return redact(await wallStreet.building(seed));
  });
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
      // An agent that claims no building is recorded as an explicit null rather than a
      // missing key, so "this is an API client's own agent" never reads as lost data and
      // the usage summary can label its spend unassigned.
      data.buildingId = data.buildingId ?? null;
      if (data.buildingId && project.library?.buildingId === data.buildingId)
        fail(409, "This building belongs to the project library");
      if (
        data.buildingId &&
        store
          .agentsForBuilding(data.projectId, data.buildingId)
          .some((a) => a.id !== data.id)
      )
        fail(
          409,
          "This building already has an agent; use its session manager",
        );
      requireRecord(store, "providers", data.providerId);
      // An agent may be assigned any repository inside the allowlist, not only the project's
      // own `workspace`. The city creates its project before anyone has chosen which repository
      // the office works in, and a project's workspace cannot change once agents exist — so
      // tying the two together left every office employee permanently without file access.
      // The boundary is unchanged: the path must be inside GHOSTGRID_ALLOWED_WORKSPACES, and
      // the engine re-checks it at run time.
      if (data.workspace)
        data.workspace = assertRepoWorkspace(
          data.workspace,
          config.allowedWorkspaces,
        );
      const assigned = data.workspace ?? project.workspace;
      if (data.permissions.includes("write")) {
        if (!assigned)
          fail(
            400,
            "A writing employee needs a repository: assign one to this office before granting write access.",
          );
        // Checked here rather than at the first task, so granting write says what is wrong
        // while the operator is still looking at the switch they flipped.
        assertRepoWorkspace(assigned, config.allowedWorkspaces);
      }
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
    // The repositories an employee can actually be assigned to. `workspaces` above is the raw
    // allowlist, which is usually a directory of projects and not a repository itself.
    repos: await listRepoCandidates(config.allowedWorkspaces),
  }));
  // ---- office work streams ----------------------------------------------------------------------
  // What a team is aimed at. Stored on the project as `officeProjects`; the slug is what an
  // employee's `officeProjectId` points at, so it never changes once created.
  const streamBody = z.object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(2_000).optional(),
    // The office to staff this stream in. With it, the stream arrives with the two people it
    // cannot work without. Without it there is no building to hire into, so it starts empty.
    buildingId: z.string().trim().min(1).max(160).optional(),
    /** Pass false to create the stream unstaffed and hire into it by hand. */
    staff: z.boolean().optional(),
  }).strict();
  route("GET", "/api/v1/office/projects", async (req) => {
    const query = z.object({ projectId: z.string().uuid() }).strict().parse(req.query);
    return { items: listStreams(store, query.projectId) };
  });
  route("POST", "/api/v1/office/projects", async (req, reply) => {
    const body = streamBody.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    const stream = createStream(store, body.projectId, body);
    // A stream with nobody on it does not fail at creation time with something to fix; it fails
    // at run time with a warning, having charged for a plan nobody can implement. So it is
    // staffed on the way in: one lead to delegate, one engineer to implement.
    let staff: StaffedStream | null = null;
    if (body.buildingId && body.staff !== false)
      staff = staffStream(store, sessions, {
        projectId: body.projectId,
        buildingId: body.buildingId,
        officeProjectId: stream.id,
        streamName: stream.name,
      });
    return reply.code(201).send(redact({ ...stream, staff }));
  }, streamBody);
  // `:slug` rather than `:id` because the router validates every `:id` as a uuid, and a work
  // stream is keyed by its slug.
  const streamPatch = z.object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    goal: z.string().trim().max(2_000).optional(),
  }).strict();
  route("PATCH", "/api/v1/office/projects/:slug", async (req) => {
    const body = streamPatch.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    return redact(updateStream(store, body.projectId, (req.params as { slug: string }).slug, body));
  }, streamPatch);
  route("DELETE", "/api/v1/office/projects/:slug", async (req) => {
    const query = z.object({ projectId: z.string().uuid() }).strict().parse(req.query);
    requireRecord(store, "projects", query.projectId);
    return deleteStream(store, query.projectId, (req.params as { slug: string }).slug,
      (sessionId) => { sessions.update(sessionId, { officeProjectId: null }); });
  });

  // ---- office roles ---------------------------------------------------------------------------
  // What a job *is*: the remit and answer shape every holder of it carries into every task. The
  // three defaults are returned until the operator edits them, so a project needs no migration.
  // Renaming or deleting a role moves its holders through SessionService, which recomposes their
  // briefs — a desk holding a job title no role defines would lose the brief it works from.
  const roleLines = z.array(z.string().trim().max(400)).min(1).max(24);
  const roleBody = z.object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(ROLE_KINDS as [RoleKind, ...RoleKind[]]).optional(),
    rank: z.number().int().min(-50).max(50).optional(),
    remit: roleLines.optional(),
    answer: roleLines.optional(),
  }).strict();
  route("GET", "/api/v1/office/roles", async (req) => {
    const query = z.object({ projectId: z.string().uuid() }).strict().parse(req.query);
    const roles = listRoles(store, query.projectId);
    // Holder counts come back with the roles so the editor can warn before a delete, and
    // presets so "new role" starts from a real job description rather than an empty form.
    const staff = store
      .list("sessions", { projectId: query.projectId })
      .filter((session) => session.status !== "archived" && !session.officeWorker);
    return {
      items: roles.map((role) => ({
        ...role,
        holders: staff.filter((session) => resolveRole(roles, session.title as string).id === role.id).length,
      })),
      kinds: ROLE_KINDS.map((kind) => ({ kind, summary: KIND_SUMMARY[kind] })),
      presets: rolePresets(),
    };
  });
  route("POST", "/api/v1/office/roles", async (req, reply) => {
    const body = roleBody.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    return reply.code(201).send(redact(createRole(store, body.projectId, body)));
  }, roleBody);
  // `:slug` for the same reason work streams use one: the router validates every `:id` as a uuid.
  const rolePatch = z.object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(80).optional(),
    kind: z.enum(ROLE_KINDS as [RoleKind, ...RoleKind[]]).optional(),
    rank: z.number().int().min(-50).max(50).optional(),
    remit: roleLines.optional(),
    answer: roleLines.optional(),
  }).strict();
  route("PATCH", "/api/v1/office/roles/:slug", async (req) => {
    const body = rolePatch.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    // Resolved against the role list as it was *before* the edit, so a rename finds the holders
    // by the title they still have, and an employee with no title — who resolves to the most
    // junior role everywhere else — is re-briefed like any other holder.
    const before = listRoles(store, body.projectId);
    const { role, renamedFrom } = updateRole(store, body.projectId, (req.params as { slug: string }).slug, body);
    let rebriefed = 0;
    for (const session of store.list("sessions", { projectId: body.projectId })) {
      if (session.status === "archived" || session.officeWorker) continue;
      if (resolveRole(before, session.title as string | undefined).id !== role.id) continue;
      // Same title on a renamed role is still a write: it is what rebuilds the stored brief
      // from the role's new remit.
      sessions.update(session.id as string, { title: role.name });
      rebriefed++;
    }
    return redact({ ...role, renamedFrom, rebriefed });
  }, rolePatch);
  route("DELETE", "/api/v1/office/roles/:slug", async (req) => {
    const query = z.object({
      projectId: z.string().uuid(),
      reassignTo: z.string().trim().max(100).optional(),
    }).strict().parse(req.query);
    requireRecord(store, "projects", query.projectId);
    return deleteRole(
      store,
      query.projectId,
      (req.params as { slug: string }).slug,
      (sessionId, title) => { sessions.update(sessionId, { title }); },
      query.reassignTo,
    );
  });

  // ---- promote and demote ---------------------------------------------------------------------
  // One rung of the role ladder, up or down, by rank. The brief is rebuilt by the same session
  // write every other org change goes through, so a promoted employee's next task is briefed as
  // the new job and not the old one.
  for (const direction of ["promote", "demote"] as const) {
    route("POST", `/api/v1/office/employees/:id/${direction}`, async (req) => {
      const session = requireRecord(store, "sessions", (req.params as { id: string }).id);
      if (session.officeWorker)
        fail(409, "That desk is an external terminal window, not a backend employee with a role.");
      const agent = requireRecord(store, "agents", session.agentId as string);
      const roles = listRoles(store, agent.projectId as string);
      const from = resolveRole(roles, session.title as string | undefined);
      const target = ladderStep(roles, from.name, direction);
      if (!target)
        fail(
          409,
          direction === "promote"
            ? `${from.name} is already the most senior role in this office. Add a more senior role first.`
            : `${from.name} is already the most junior role in this office. Add a more junior role first.`,
        );
      // Reports are left where they are: a demoted manager keeps their reports until the
      // operator moves them, which is visible in the org chart rather than guessed at here.
      const updated = sessions.update(session.id as string, { title: target.name });
      return redact({ employee: updated, from: from.name, to: target.name, direction });
    });
  }

  // ---- office orchestration -------------------------------------------------------------------
  // The office's employees are backend sessions with a role brief; these routes staff them onto a
  // work stream as a dependency graph and report what the engine is doing with it.
  const orchestrateSchema = z.object({
    projectId: z.string().uuid(),
    buildingId: z.string().trim().min(1).max(160),
    officeProjectId: z.string().trim().min(1).max(64),
    goal: z.string().trim().max(2_000).optional(),
    scope: z.enum(["project", "building"]).optional(),
    notes: z.string().trim().max(2_000).optional(),
    // Stages that hold for the operator before they run, e.g. ["build"] to read the lead's
    // approach before anybody touches a file.
    approvals: z.array(z.enum(["plan", "design", "build", "review", "signoff"])).max(5).optional(),
    priority: z.number().int().min(-100).max(100).optional(),
  }).strict();
  route("GET", "/api/v1/office/staff", async (req) => {
    const query = z.object({ projectId: z.string().uuid(), buildingId: z.string().min(1).max(160) })
      .strict().parse(req.query);
    requireRecord(store, "projects", query.projectId);
    return { items: orchestrator.staff(query.projectId, query.buildingId) };
  });
  // A dry run: the same graph the engine would be given, with nothing submitted or charged.
  route("POST", "/api/v1/office/orchestrate/plan", async (req) => {
    const body = orchestrateSchema.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    return redact(orchestrator.plan(body));
  }, orchestrateSchema);
  route("POST", "/api/v1/office/orchestrate", async (req, reply) => {
    const body = orchestrateSchema.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    return reply.code(201).send(redact(orchestrator.run(body)));
  }, orchestrateSchema);
  route("GET", "/api/v1/office/orchestrations", async (req) => {
    const query = z.object({ projectId: z.string().uuid(), buildingId: z.string().min(1).max(160).optional() })
      .strict().parse(req.query);
    requireRecord(store, "projects", query.projectId);
    return { items: orchestrator.list(query.projectId, query.buildingId) };
  });
  route("GET", "/api/v1/office/orchestrations/:id", async (req) =>
    redact(orchestrator.get((req.params as { id: string }).id)));
  // Deliberately separate from the run above: that one is polled every couple of seconds while a
  // run is in flight and has to stay small, this one carries every prompt and every result and is
  // read once, when somebody wants to know what the team actually said.
  route("GET", "/api/v1/office/orchestrations/:id/transcript", async (req) =>
    redact(orchestrator.transcript((req.params as { id: string }).id)));
  route("POST", "/api/v1/office/orchestrations/:id/cancel", async (req) =>
    redact(orchestrator.cancel((req.params as { id: string }).id)));
  // A gated step waits in `awaiting_approval` until one of these is called. The node key is in
  // the body because `route()` validates every `:param` as a UUID and a node key is not one.
  const decisionBody = z.object({
    key: z.string().regex(/^[\w-]+$/).max(100),
    reason: z.string().trim().max(500).optional(),
  }).strict();
  for (const decision of ["approve", "reject"] as const)
    route("POST", `/api/v1/office/orchestrations/:id/${decision}`, async (req) => {
      const body = decisionBody.parse(req.body);
      return redact(
        orchestrator.decide(
          (req.params as { id: string }).id,
          body.key,
          decision,
          body.reason,
        ),
      );
    }, decisionBody);

  // ---- project subtasks ---------------------------------------------------------------------
  // The operator writes a prompt; it goes to the project's lead, who names the engineer and
  // briefs them. The engineer's task is created from that answer, so the hand-off is real.
  const subtaskSchema = z.object({
    projectId: z.string().uuid(),
    buildingId: z.string().trim().min(1).max(160),
    officeProjectId: z.string().trim().min(1).max(64),
    prompt: z.string().trim().min(1).max(4_000),
  }).strict();
  route("POST", "/api/v1/office/subtasks", async (req, reply) => {
    const body = subtaskSchema.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    return reply.code(201).send(redact(subtasks.create(body)));
  }, subtaskSchema);
  route("GET", "/api/v1/office/subtasks", async (req) => {
    const query = z.object({
      projectId: z.string().uuid(),
      buildingId: z.string().min(1).max(160).optional(),
      officeProjectId: z.string().min(1).max(64).optional(),
    }).strict().parse(req.query);
    requireRecord(store, "projects", query.projectId);
    return { items: subtasks.list(query.projectId, query.buildingId, query.officeProjectId) };
  });
  route("GET", "/api/v1/office/subtasks/:id", async (req) =>
    redact(subtasks.get((req.params as { id: string }).id)));
  route("POST", "/api/v1/office/subtasks/:id/cancel", async (req) =>
    redact(subtasks.cancel((req.params as { id: string }).id)));

  // ---- skills deck ----------------------------------------------------------------------------
  // Downloads real skill folders through skills.sh: model scope installs for every terminal of a
  // CLI, employee scope installs into one project folder (allowlist-checked) so only that desk
  // picks it up.
  const skillRuntime = z.enum(["claude", "codex", "deepseek"]);
  const skillName = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
  route("GET", "/api/v1/office/skills", async (req) => {
    const query = z.object({ runtime: skillRuntime, workspace: z.string().min(1).max(4096).optional() })
      .strict().parse(req.query);
    return redact(await skillsRunner.list(query.runtime, query.workspace));
  });
  const skillInstallSchema = z.object({
    runtime: skillRuntime,
    skills: z.array(skillName).min(1).max(10),
    workspace: z.string().min(1).max(4096).optional(),
  }).strict();
  route("POST", "/api/v1/office/skills/install", async (req) => {
    const body = skillInstallSchema.parse(req.body);
    // Returns raw skills.sh stdout/stderr, which can echo an environment.
    return redact(await skillsRunner.install(body.runtime, body.skills, body.workspace));
  }, skillInstallSchema);
  const skillRemoveSchema = z.object({
    runtime: skillRuntime,
    skill: skillName,
    workspace: z.string().min(1).max(4096).optional(),
  }).strict();
  route("POST", "/api/v1/office/skills/remove", async (req) => {
    const body = skillRemoveSchema.parse(req.body);
    return redact(await skillsRunner.remove(body.runtime, body.skill, body.workspace));
  }, skillRemoveSchema);
  // The desks the machine already has: every coding CLI open in a terminal, scanned live.
  route("GET", "/api/v1/office/processes", async () => cachedCliScan());
  // What one of those terminals is actually doing, read from the CLI's own transcript. A pid
  // with no session registry entry is not an error: it is a CLI that keeps no transcript.
  // Answer a desk. The office could read a terminal's transcript and never reply to it; the CLI
  // can continue its own session non-interactively, so a message here lands in that same session
  // and its answer appears in the transcript the desk is already showing.
  const deskMessage = z
    .object({
      pid: z.number().int().min(1).max(4_194_304),
      prompt: z.string().trim().min(1).max(MAX_PROMPT),
    })
    .strict();
  route("POST", "/api/v1/office/activity/message", async (req) => {
    const body = deskMessage.parse(req.body);
    // The reply is the CLI's own words, which can quote whatever the operator typed into that
    // terminal — redacted like every other transcript route.
    return redact(
      await messageCliSession(body.pid, body.prompt, {
        allowedWorkspaces: config.allowedWorkspaces,
      }),
    );
  }, deskMessage);
  route("GET", "/api/v1/office/activity", async (req) => {
    const query = z
      .object({
        pid: z.coerce.number().int().min(1).max(4_194_304),
        limit: z.coerce.number().int().min(1).max(200).default(40),
      })
      .strict()
      .parse(req.query);
    const activity = await cliActivity(query.pid, query.limit);
    if (!activity) fail(404, "No readable session for that process");
    // A CLI transcript is verbatim terminal history: the one place an operator is most likely to
    // have pasted a key or run `export ANTHROPIC_API_KEY=…`. Every sibling content route redacts;
    // this one did not, which defeated the whole registerSecret/redact design.
    return redact(activity);
  });
  // ---- hiring engineers ------------------------------------------------------------------------
  // The one unbounded role. A stream has exactly one lead, because a subtask has to resolve to a
  // single delegate, and as many engineers as the operator wants. Every hire reports to that
  // lead, so the delegation graph stays a tree and nobody ends up with two managers.
  const engineerSchema = z.object({
    projectId: z.string().uuid(),
    buildingId: z.string().trim().min(1).max(160),
    officeProjectId: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80).optional(),
  }).strict();
  route("POST", "/api/v1/office/engineers", async (req, reply) => {
    const body = engineerSchema.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    return reply.code(201).send(redact(hireEngineer(store, sessions, body)));
  }, engineerSchema);

  // ---- the stream log --------------------------------------------------------------------------
  // Who is on a work stream, what each of them is doing right now, and the stream's history
  // newest first. One read for the whole stream: a poll per desk is what made the office
  // expensive to watch.
  route("GET", "/api/v1/office/log", async (req) => {
    const query = z.object({
      projectId: z.string().uuid(),
      buildingId: z.string().min(1).max(160),
      officeProjectId: z.string().min(1).max(64).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(120),
    }).strict().parse(req.query);
    requireRecord(store, "projects", query.projectId);
    // Task prompts are operator text and employee text, so this is redacted like every other
    // content route rather than trusted to be free of pasted keys.
    return redact(streamLog(store, query));
  });

  // ---- interns -------------------------------------------------------------------------------
  // An engineer's own helper, hired by that engineer rather than planned by the orchestrator.
  // The orchestrator never gives an intern a node: they exist because one engineer decided a
  // piece of their task was worth handing off, and they report to that engineer.
  const internSchema = z.object({
    projectId: z.string().uuid(),
    buildingId: z.string().trim().min(1).max(160),
    /** The engineer hiring them. Must be an implementing role — an intern cannot hire. */
    engineerSessionId: z.string().uuid(),
    name: z.string().trim().min(1).max(80).optional(),
    /** What they are being hired to do. Submitted as their first task when given. */
    task: z.string().trim().min(1).max(4_000).optional(),
  }).strict();
  route("POST", "/api/v1/office/interns", async (req, reply) => {
    const body = internSchema.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    const building = store.agentsForBuilding(body.projectId, body.buildingId)[0];
    if (!building) fail(404, "Office building not found");
    const staff = orchestrator.staff(body.projectId, body.buildingId);
    const engineer = staff.find((person) => person.sessionId === body.engineerSessionId);
    if (!engineer) fail(404, "That employee does not work in this office");
    // Only an implementing role hires interns. A lead that could hire its own helper would be
    // implementing through the back door, and an intern that could hire would have no bottom.
    if (engineer.roleKind !== "build")
      fail(409, `Only an engineer can hire an intern; ${engineer.name} is a ${engineer.title}.`);
    const internName = body.name?.trim() || `${engineer.name}'s intern`;
    const session = sessions.create({
      projectId: body.projectId,
      agentId: building.id,
      name: internName,
      title: "Intern",
      team: engineer.team,
      // Reporting line and staffing both come from the engineer: an intern is on whatever work
      // stream their engineer is on, and answers to them.
      managerId: engineer.sessionId,
      officeProjectId: engineer.officeProjectId,
    });
    let task = null;
    if (body.task) {
      task = engine.submitTask({
        projectId: body.projectId,
        agentId: building.id,
        sessionId: session.id,
        title: `Intern task — ${internName}`,
        prompt: [
          `You are ${internName}, an intern helping ${engineer.name}, ${engineer.title}.`,
          `They are accountable for the task this is a piece of; you are accountable to them.`,
          "",
          "Your piece:",
          body.task,
          "",
          "Do exactly this piece. If it cannot be done without changing something outside it, stop and say so rather than widening the work.",
          "You have less context than the engineer who briefed you, so when something is ambiguous say which reading you took and why.",
          "Report what you did and what it printed, in enough detail that they can check it without redoing it.",
        ].join("\n"),
      });
    }
    return reply.code(201).send(redact({ intern: { sessionId: session.id, name: internName, engineerSessionId: engineer.sessionId, engineerName: engineer.name, team: engineer.team }, task }));
  }, internSchema);

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
    runtime: z.enum([
      "codex", "claude", "deepseek",
      "chatgpt-browser", "claude-browser", "deepseek-browser",
    ]),
    workspace: z.string().min(1).optional(),
  }).strict();
  route("POST", "/api/v1/office/workers", async (req, reply) => {
    const body = officeWorkerSchema.parse(req.body);
    requireRecord(store, "projects", body.projectId);
    const building = store.agentsForBuilding(body.projectId, body.buildingId)[0];
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
      ...officeOrgFields,
    })
    .strict();
  route(
    "PATCH",
    "/api/v1/sessions/:id",
    async (req) => {
      const id = (req.params as { id: string }).id;
      const patch = sessionPatch.parse(req.body);
      // A lead is pinned to the stream they lead: their engineers report to them and the
      // stream's subtasks are addressed to them, so moving them silently breaks both.
      assertLeadStaysPut(store, requireRecord(store, "sessions", id), patch);
      return redact(sessions.update(id, patch));
    },
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
    .object({
      name: z.string().trim().min(1).max(160).default("New session"),
      ...officeOrgFields,
    })
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
  // The newest sequence number, so a client can stream from "now" without paging
  // through the whole history first.
  route("GET", "/api/v1/events/head", async (req) => {
    const filters = z
      .object({
        taskId: z.string().uuid().optional(),
        sessionId: z.string().uuid().optional(),
        agentId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.query ?? {});
    return { seq: store.latestEventSeq(filters) };
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
      // An intern was hired by one engineer for one piece of that engineer's task and is
      // accountable to them, not to the operator. Letting the operator brief one directly would
      // put work into the office that the engineer who owns it never sees.
      const kind = resolveRole(listRoles(store, session.projectId), session.title as string | undefined).kind;
      if (kind === "intern") {
        const engineer = session.managerId ? store.get("sessions", session.managerId as string) : null;
        fail(409, `${session.name ?? "This intern"} is an intern and answers to ${engineer?.name ?? "the engineer who hired them"}. Send it to them instead.`);
      }
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
  route("POST", "/api/v1/tasks/:id/approve", async (req) =>
    redact(engine.approveTask((req.params as { id: string }).id)),
  );
  const rejectBody = z
    .object({ reason: z.string().trim().max(500).optional() })
    .strict();
  route(
    "POST",
    "/api/v1/tasks/:id/reject",
    async (req) =>
      redact(
        engine.rejectTask(
          (req.params as { id: string }).id,
          rejectBody.parse(req.body ?? {}).reason,
        ),
      ),
    rejectBody,
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
    const { refresh, projectId } = z
      .object({ refresh: z.enum(["0", "1"]).optional(), projectId: z.string().uuid().optional() })
      .strict()
      .parse(req.query);
    if (projectId) requireRecord(store, "projects", projectId);
    // Both reads are independent network/disk work, so they overlap instead of queueing.
    const [credits, cliRows] = await Promise.all([
      providerCredits.read(refresh === "1"),
      localCliUsage(refresh === "1"),
    ]);
    // Balances come from the vendors; token counts come from our own usage records, so a
    // provider with no balance endpoint still reports what it actually spent.
    const usage = store.usageSummary(projectId);
    // Claude Code and Codex bill a subscription rather than one of our keys, so their spend is
    // read from their own local transcripts and appended after the vendor/usage merge.
    // Vendor payloads and `detail` strings built from raw vendor errors both land here, so this
    // goes out scrubbed like every other response.
    return redact({
      ...credits,
      rows: [
        ...withRecordedUsage(credits.rows, usage.providers as unknown as UsageProviderRow[]),
        ...cliRows,
      ],
      usage,
    });
  });
  route("GET", "/api/v1/usage/summary", async (req) => {
    const { projectId } = z.object({ projectId: z.string().uuid().optional() }).strict().parse(req.query);
    if (projectId) requireRecord(store, "projects", projectId);
    // The sibling /api/v1/usage redacts; this one did not.
    return redact(store.usageSummary(projectId));
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
  return { app, store, engine, sessions, library, wallStreet, registry, config };
}
