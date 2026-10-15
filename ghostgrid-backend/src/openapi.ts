import { z } from "zod";
type Schema = Record<string, any>;
export type OpenApiDocument = Record<string, any>;
const str = { type: "string" };
const nullableString = { type: ["string", "null"] };
const uuid = { type: "string", format: "uuid" };
const libraryIdentifier = { type: "string", pattern: "^[A-Za-z0-9_-]{1,100}$" };
const number = { type: ["number", "null"] };
const object = (properties: Schema, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (items: Schema) => ({ type: "array", items });
const statuses = [
  "pending",
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
];
const identity = {
  id: uuid,
  createdAt: { type: "string", format: "date-time" },
  updatedAt: { type: "string", format: "date-time" },
};
export function createOpenApi(apiToken?: string): OpenApiDocument {
  const schemas: Schema = {
    TaskStatus: { type: "string", enum: statuses },
    Error: object(
      {
        error: object({ code: str, message: str, requestId: str }, [
          "code",
          "message",
          "requestId",
        ]),
      },
      ["error"],
    ),
    Project: object(
      {
        ...identity,
        name: str,
        description: str,
        workspace: str,
        instructions: str,
        library: { anyOf: [ref("LibraryConnection"), { type: "null" }] },
      },
      ["id", "name"],
    ),
    ProviderCapabilities: object(
      Object.fromEntries(
        [
          "inference",
          "coding",
          "streaming",
          "resume",
          "cancellation",
          "tools",
          "approvals",
        ].map((k) => [k, { type: "boolean" }]),
      ),
      [
        "inference",
        "coding",
        "streaming",
        "resume",
        "cancellation",
        "tools",
        "approvals",
      ],
    ),
    Availability: object(
      {
        available: { type: "boolean" },
        reason: str,
        message: str,
        models: array(str),
      },
      ["available"],
    ),
    Provider: object(
      {
        ...identity,
        name: str,
        type: {
          type: "string",
          enum: ["mock", "codex", "claude", "deepseek", "openai-compatible", "chatgpt-browser", "claude-browser", "deepseek-browser"],
        },
        baseUrl: str,
        model: str,
        apiKeyEnv: str,
        auth: { type: "string", enum: ["bearer", "none", "header"] },
        apiKeyHeader: str,
        headersEnv: { type: "object", additionalProperties: str },
        queryParameters: { type: "object", additionalProperties: str },
        concurrency: { type: "integer" },
        timeoutMs: { type: "integer" },
        supportsStreaming: { type: "boolean" },
        supportsModelDiscovery: { type: "boolean" },
        availability: ref("Availability"),
        capabilities: ref("ProviderCapabilities"),
        checkedAt: str,
        pricing: object({
          inputPerMillion: { type: "number" },
          outputPerMillion: { type: "number" },
        }),
      },
      ["id", "name", "type"],
    ),
    Agent: object(
      {
        ...identity,
        name: str,
        buildingId: {
          ...nullableString,
          description:
            "City building this agent owns. Null for an agent that belongs to no building; such an agent is its own building for building-scoped filters, and its usage is reported under a null buildingId.",
        },
        projectId: uuid,
        providerId: uuid,
        role: str,
        workspace: nullableString,
        permissions: array({ type: "string", enum: ["read", "write"] }),
      },
      ["id", "name", "projectId", "providerId", "permissions"],
    ),
    Message: object(
      {
        role: { type: "string", enum: ["system", "user", "assistant", "tool"] },
        content: str,
      },
      ["role", "content"],
    ),
    Session: object(
      {
        ...identity,
        buildingId: str,
        projectId: uuid,
        agentId: uuid,
        name: str,
        status: { type: "string", enum: ["active", "archived"] },
        providerSessionId: nullableString,
        messages: array(ref("Message")),
        memory: {
          type: "string",
          maxLength: 16000,
          description: "Persistent notes included in subsequent session turns",
        },
        lastRecovery: object({
          reason: str,
          at: { type: "string", format: "date-time" },
        }),
        taskCount: { type: "integer" },
        activeTaskCount: { type: "integer" },
        taskCounts: {
          type: "object",
          additionalProperties: { type: "integer" },
        },
        resumePending: { type: "boolean" },
        cancelledTaskIds: array(uuid),
      },
      ["id", "projectId", "agentId", "name", "status", "messages"],
    ),
    Task: object(
      {
        ...identity,
        projectId: uuid,
        agentId: uuid,
        sessionId: uuid,
        workflowId: uuid,
        title: str,
        prompt: str,
        status: ref("TaskStatus"),
        priority: { type: "integer" },
        dependencies: array(uuid),
        contextIds: array(uuid),
        startedAt: nullableString,
        completedAt: nullableString,
        result: {},
        error: {
          anyOf: [{ type: "null" }, object({ code: str, message: str })],
        },
        usage: { anyOf: [ref("Usage"), { type: "null" }] },
        attempts: { type: "integer" },
        requiresApproval: { type: "boolean" },
        approvedAt: nullableString,
        approvedBy: nullableString,
        // The composed prompt the provider was given: role brief, project instructions, saved
        // session notes, the task prompt and every dependency output.
        effectivePrompt: nullableString,
      },
      ["id", "projectId", "agentId", "title", "prompt", "status"],
    ),
    WorkflowNode: object(
      {
        key: str,
        agentId: uuid,
        sessionId: uuid,
        contextIds: array(uuid),
        priority: { type: "integer", minimum: -100, maximum: 100 },
        timeoutMs: { type: "integer", minimum: 10, maximum: 3600000 },
        maxRetries: { type: "integer", minimum: 0, maximum: 3 },
        taskId: uuid,
        title: str,
        prompt: str,
        dependsOn: array(str),
        requiresApproval: { type: "boolean" },
      },
      ["key", "agentId", "prompt"],
    ),
    Workflow: object(
      {
        ...identity,
        projectId: uuid,
        name: str,
        status: {
          type: "string",
          enum: ["pending", "running", "completed", "failed", "cancelled"],
        },
        nodes: array(ref("WorkflowNode")),
        result: array(object({ taskId: uuid, result: {}, error: {} })),
      },
      ["id", "projectId", "name", "status"],
    ),
    Event: object(
      {
        ...identity,
        buildingId: str,
        providerId: uuid,
        seq: { type: "integer", minimum: 1 },
        timestamp: { type: "string", format: "date-time" },
        type: str,
        taskId: { type: ["string", "null"] },
        sessionId: { type: ["string", "null"] },
        agentId: uuid,
        projectId: uuid,
        data: {},
      },
      ["id", "seq", "timestamp", "type", "taskId", "data"],
    ),
    Artifact: object(
      {
        ...identity,
        projectId: uuid,
        taskId: uuid,
        path: str,
        relativePath: str,
        name: str,
        mimeType: str,
        agentId: uuid,
      },
      ["id", "projectId", "taskId"],
    ),
    UsageTotals: object({
      requests: { type: "integer" }, inputTokens: { type: "number" }, outputTokens: { type: "number" },
      cachedInputTokens: { type: "number", description: "Prompt tokens served from cache. Already counted inside inputTokens; reported so a caller can show how much of the input was not fresh." },
      reportedCostUsd: { type: "number" }, estimatedCostUsd: { type: "number" },
      unknownCostRequests: { type: "integer" }, unknownTokenRequests: { type: "integer" },
    }, ["requests", "inputTokens", "outputTokens", "cachedInputTokens", "reportedCostUsd", "estimatedCostUsd", "unknownCostRequests", "unknownTokenRequests"]),
    ProviderCredits: object({ fetchedAt: number, usage: ref("UsageSummary"), rows: array({ allOf: [object({ id: str, name: str, provider: str, status: { type: "string", enum: ["ok", "nokey", "unsupported", "error"] }, balanceUsd: number, currency: str, detail: str, tokensUsed: number, quota: object({ limitTokens: number, remainingTokens: number, limitRequests: number, remainingRequests: number, resetTokens: str, resetRequests: str }), source: { type: "string", enum: ["vendor", "local-cli"] }, cacheReadTokens: number, cacheWriteTokens: number, plan: str, sessions: number, lastActivity: str, windows: array(object({ label: str, usedPercent: number, resetsAt: str }, ["label", "usedPercent"])), models: array(object({ model: str, tokens: number, requests: number }, ["model", "tokens", "requests"])) }, ["provider", "status"]), ref("UsageTotals")] }) }, ["fetchedAt", "rows"]),
    // One person on a work stream, with the line the log shows under their name. `talkable` is
    // the contract for the operator's chat: false for an intern, who answers to the engineer who
    // hired them, and the messages route refuses one with 409.
    OfficeLogPerson: object({
      sessionId: uuid, name: str, title: str,
      roleKind: { type: "string", enum: ["manage", "lead", "build", "intern"] },
      managerId: nullableString, managerName: nullableString, team: str,
      activeTasks: { type: "integer" }, totalTasks: { type: "integer" },
      doing: str, talkable: { type: "boolean" },
    }, ["sessionId", "name", "title", "roleKind", "managerId", "managerName", "team", "activeTasks", "totalTasks", "doing", "talkable"]),
    OfficeLogEntry: object({
      id: uuid, at: str, sessionId: uuid, who: str, title: str,
      roleKind: { type: "string", enum: ["manage", "lead", "build", "intern"] },
      label: str, summary: str, status: str,
      startedAt: nullableString, completedAt: nullableString,
      durationMs: { anyOf: [{ type: "number" }, { type: "null" }] },
      error: nullableString,
      // Set when the task is a node of an orchestration run or a subtask, so the log can group it.
      workflowId: nullableString,
    }, ["id", "at", "sessionId", "who", "title", "roleKind", "label", "summary", "status", "startedAt", "completedAt", "durationMs", "error", "workflowId"]),
    OfficeStreamLog: object({
      officeProjectId: nullableString,
      staff: array(ref("OfficeLogPerson")),
      entries: array(ref("OfficeLogEntry")),
      total: { type: "integer", description: "Tasks on the stream before the feed was clipped to `limit`." },
    }, ["officeProjectId", "staff", "entries", "total"]),
    /** Somebody a hiring call created. */
    OfficeHire: object({
      sessionId: uuid, name: str, title: str,
      roleKind: { type: "string", enum: ["manage", "lead", "build", "intern"] },
      managerId: nullableString,
    }, ["sessionId", "name", "title", "roleKind", "managerId"]),
    // A work stream, with whoever was staffed onto it when it was created.
    OfficeStream: object({
      id: str, name: str, goal: str,
      staff: { anyOf: [object({ lead: ref("OfficeHire"), engineers: array(ref("OfficeHire")), hired: array(ref("OfficeHire")) }, ["lead", "engineers", "hired"]), { type: "null" }] },
    }, ["id", "name", "goal"]),
    CliActivity: object({
      pid: number, sessionId: str, name: nullableString, status: nullableString, cwd: nullableString,
      version: nullableString, startedAt: nullableString, updatedAt: nullableString,
      lines: array(object({ kind: { type: "string", enum: ["prompt", "say", "tool", "result", "error", "hook", "subagent"] }, text: str, at: str }, ["kind", "text"])),
      // Subagents the CLI spawned for itself, read out of its own transcript. The office draws a
      // desk per entry, under the desk that spawned it.
      subagents: array(object({ id: str, description: str, agentType: nullableString, at: nullableString }, ["id", "description"])),
    }, ["pid", "sessionId", "lines", "subagents"]),
    UsageSummary: object({
      totals: ref("UsageTotals"), today: ref("UsageTotals"),
      providers: array({ allOf: [ref("UsageTotals"), object({ providerId: nullableString, name: nullableString, type: nullableString, baseUrl: nullableString })] }),
      // One row per agent that spent anything. `buildingId` is null when the agent owns no
      // city building; `agentId` and `name` are always present so that spend can still be
      // shown (as unassigned) instead of disappearing.
      agents: array({ allOf: [ref("UsageTotals"), object({ agentId: str, name: str, buildingId: nullableString }, ["agentId", "name"])] }),
      tokensLastMinute: { type: "number" }, fetchedAt: str, dayStart: str,
    }, ["totals", "today", "providers", "agents", "tokensLastMinute", "fetchedAt", "dayStart"]),
    Usage: object(
      {
        ...identity,
        taskId: uuid,
        agentId: uuid,
        providerId: uuid,
        projectId: uuid,
        inputTokens: number,
        outputTokens: number,
        cachedInputTokens: number,
        costUsd: number,
        estimatedCostUsd: number,
        costSource: {
          type: "string",
          enum: ["estimated", "reported", "unknown"],
        },
      },
      ["inputTokens", "outputTokens"],
    ),
    Context: object(
      {
        ...identity,
        projectId: uuid,
        title: str,
        content: str,
        taskId: { type: ["string", "null"] },
        sourceTaskId: uuid,
        agentId: uuid,
        fileReference: str,
        source: { type: "object", additionalProperties: true },
      },
      ["id", "projectId", "title", "content"],
    ),
    LibraryConnection: object(
      {
        name: str,
        buildingId: libraryIdentifier,
        baseUrl: { type: "string", format: "uri" },
        apiKeyEnv: str,
        timeoutMs: { type: "integer" },
        repositoryUrl: { type: "string", format: "uri" },
        connectedAt: { type: "string", format: "date-time" },
      },
      [
        "name",
        "buildingId",
        "baseUrl",
        "timeoutMs",
        "repositoryUrl",
        "connectedAt",
      ],
    ),
    LibraryStatus: object(
      {
        available: { type: "boolean" },
        readOnly: { const: true },
        repositoryUrl: { type: "string", format: "uri" },
        catalogVersion: {},
        checkedAt: { type: "string", format: "date-time" },
      },
      ["available", "readOnly", "repositoryUrl", "catalogVersion", "checkedAt"],
    ),
    Metrics: object(
      {
        tasks: { type: "object", additionalProperties: { type: "integer" } },
        activeAgents: { type: "integer" },
        capacity: object({
          concurrency: { type: "integer" },
          inUse: { type: "integer" },
          utilization: { type: "number" },
        }),
        workflowCompletionRate: number,
        providers: array(
          object({
            id: uuid,
            availability: { anyOf: [ref("Availability"), { type: "null" }] },
          }),
        ),
        durations: array(
          object({ taskId: uuid, durationMs: { type: "number" } }),
        ),
        durationsTotal: { type: "integer", minimum: 0 },
        durationLimit: { type: "integer", minimum: 1, maximum: 500 },
        durationOffset: { type: "integer", minimum: 0 },
      },
      ["tasks", "activeAgents", "capacity"],
    ),
    Status: object(
      {
        status: str,
        version: str,
        workerConcurrency: { type: "integer" },
        storage: str,
        codingIsolation: str,
        resources: str,
      },
      ["status"],
    ),
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Ghost Grid Backend",
      version: "0.1.0",
      description:
        "Persistent local agent orchestration. Usage reflects reported operational metrics; no game currency.",
    },
    servers: [{ url: "http://127.0.0.1:3001" }],
    paths: {},
    components: {
      schemas,
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    security: apiToken ? [{ bearerAuth: [] }] : [],
  };
}
function responseSchema(method: string, url: string): Schema {
  if (url === "/health") return object({ status: str }, ["status"]);
  if (url.endsWith("/openapi.json"))
    return { type: "object", additionalProperties: true };
  if (url.includes("/library")) {
    if (url.endsWith("/status")) return ref("LibraryStatus");
    if (url.endsWith("/context")) return ref("Context");
    if (url.endsWith("/library"))
      return method === "GET"
        ? object(
            {
              connection: {
                anyOf: [ref("LibraryConnection"), { type: "null" }],
              },
            },
            ["connection"],
          )
        : ref("LibraryConnection");
    // Upstream read-only responses retain their own fields, rather than project fields.
    return { type: "object", additionalProperties: true };
  }
  if (url === "/api/v1/office/activity") return ref("CliActivity");
  if (url === "/api/v1/office/log") return ref("OfficeStreamLog");
  if (url === "/api/v1/office/engineers") return ref("OfficeHire");
  if (url === "/api/v1/office/projects")
    return method === "GET"
      ? object({ items: array(ref("OfficeStream")) }, ["items"])
      : ref("OfficeStream");
  if (url === "/api/v1/office/projects/{slug}") return ref("OfficeStream");
  if (url === "/api/v1/provider-credits") return ref("ProviderCredits");
  if (url === "/api/v1/usage/summary") return ref("UsageSummary");
  if (url.endsWith("/status")) return ref("Status");
  if (url.endsWith("/metrics")) return ref("Metrics");
  if (url.endsWith("/test"))
    return {
      allOf: [
        ref("Availability"),
        object({ capabilities: ref("ProviderCapabilities") }, ["capabilities"]),
      ],
    };
  const names: Record<string, string> = {
    projects: "Project",
    providers: "Provider",
    agents: "Agent",
    sessions: "Session",
    tasks: "Task",
    workflows: "Workflow",
    artifacts: "Artifact",
    usage: "Usage",
    context: "Context",
    events: "Event",
  };
  const segments = url.split("/").filter(Boolean);
  const last = segments.at(-1)!;
  if (last === "messages") return ref("Task");
  if (last === "cancel" && segments.includes("tasks")) return ref("Task");
  if (["resume", "cancel"].includes(last) && segments.includes("sessions"))
    return ref("Session");
  if (["run", "cancel"].includes(last) && segments.includes("workflows"))
    return ref("Workflow");
  let resource = names[last] ? last : segments[2];
  const name = names[resource ?? ""] ?? "Status";
  const list = method === "GET" && names[last] !== undefined;
  if (list) {
    const properties: Schema = { items: array(ref(name)) };
    if (["events"].includes(last)) {
      properties.nextCursor = { type: "integer" };
    } else if (segments.length === 3) {
      properties.total = { type: "integer" };
    }
    return object(properties, ["items"]);
  }
  return ref(name);
}
export function registerOperation(
  spec: OpenApiDocument,
  method: string,
  url: string,
  body?: z.ZodType,
): void {
  const verb = method.toUpperCase();
  const path = url.replace(/:([\w]+)/g, "{$1}");
  const parameters: Schema[] = [...url.matchAll(/:([\w]+)/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: match[1] === "articleId" ? libraryIdentifier : uuid,
  }));
  const query = (name: string, schema: Schema) =>
    parameters.push({ name, in: "query", required: false, schema });
  if (verb === "GET" && url.endsWith("/metrics")) {
    query("limit", { type: "integer", minimum: 1, maximum: 500, default: 100 });
    query("offset", { type: "integer", minimum: 0, default: 0 });
  } else if (verb === "GET" && url.includes("/library/")) {
    if (url.endsWith("/search")) {
      parameters.push({
        name: "q",
        in: "query",
        required: true,
        schema: { type: "string", maxLength: 1000 },
      });
      query("limit", { type: "integer", minimum: 1, maximum: 100 });
    } else if (url.endsWith("/catalog")) {
      query("offset", { type: "integer", minimum: 0, maximum: 1_000_000 });
      query("limit", { type: "integer", minimum: 1, maximum: 100 });
      query("topic_id", libraryIdentifier);
      query("subtopic_id", libraryIdentifier);
      query("access", { type: "string", enum: ["all", "free", "locked"] });
    }
  } else if (verb === "GET" && url === "/api/v1/office/activity") {
    query("pid", { type: "integer", minimum: 1 });
    query("limit", { type: "integer", minimum: 1, maximum: 200 });
  } else if (verb === "GET" && url === "/api/v1/office/log") {
    query("projectId", uuid);
    query("buildingId", { type: "string", minLength: 1, maxLength: 160 });
    query("officeProjectId", { type: "string", minLength: 1, maxLength: 64 });
    query("limit", { type: "integer", minimum: 1, maximum: 500, default: 120 });
  } else if (verb === "GET" && url === "/api/v1/provider-credits") {
    query("refresh", { type: "string", enum: ["0", "1"] });
    query("projectId", uuid);
  } else if (verb === "GET" && url === "/api/v1/usage/summary") {
    query("projectId", uuid);
  } else if (verb === "GET" && url === "/api/v1/events/head") {
    for (const name of ["taskId", "sessionId", "agentId", "projectId"])
      query(name, uuid);
  } else if (verb === "GET" && url.endsWith("/events")) {
    query("after", { type: "integer", minimum: 0 });
    query("limit", {
      type: "integer",
      minimum: 1,
      maximum: 1000,
      default: 500,
    });
    if (url === "/api/v1/events") {
      for (const name of ["taskId", "sessionId", "agentId", "projectId"])
        query(name, uuid);
    }
  } else if (verb === "GET" && url.endsWith("/stream")) {
    for (const name of ["taskId", "sessionId", "agentId", "projectId"])
      query(name, uuid);
    query("after", { type: "integer", minimum: 0 });
    parameters.push({
      name: "Last-Event-ID",
      in: "header",
      required: false,
      schema: str,
      description:
        "Persisted numeric sequence or event UUID; replays events after this cursor.",
    });
  } else if (
    verb === "GET" &&
    /^\/api\/v1\/(providers|projects|agents|sessions|tasks|workflows|usage)$/.test(
      url,
    )
  ) {
    for (const name of ["projectId", "agentId", "sessionId"]) query(name, uuid);
    query("buildingId", str);
    query("status", str);
    query("limit", { type: "integer", minimum: 1, maximum: 500, default: 100 });
    query("offset", { type: "integer", minimum: 0, default: 0 });
  }
  const code =
    verb === "DELETE"
      ? "204"
      : verb === "POST" &&
          (url === "/api/v1/tasks" || url.endsWith("/messages"))
        ? "202"
        : verb === "POST" &&
            (/^\/api\/v1\/(providers|projects|agents|sessions|workflows)$/.test(
              url,
            ) ||
              url.endsWith("/context") ||
              url.endsWith("/sessions"))
          ? "201"
          : "200";
  const media = url.endsWith("/stream")
    ? "text/event-stream"
    : url.endsWith("/content")
      ? "text/plain"
      : "application/json";
  const schema = media === "application/json" ? responseSchema(verb, url) : str;
  const responses: Schema = {
    [code]: {
      description:
        code === "202"
          ? "Task accepted for asynchronous execution"
          : code === "201"
            ? "Created"
            : code === "204"
              ? "Deleted"
              : "Success",
      ...(code === "204" ? {} : { content: { [media]: { schema } } }),
    },
  };
  for (const error of [
    "400",
    "401",
    "403",
    "404",
    "409",
    "500",
    "502",
    "503",
    "504",
  ])
    responses[error] = {
      description: (
        {
          "400": "Validation error",
          "401": "Authentication required",
          "403": "Permission denied",
          "404": "Not found",
          "409": "State or reference conflict",
          "500": "Internal server error",
          "502": "Invalid upstream response",
          "503": "Upstream credentials unavailable",
          "504": "Upstream request timed out",
        } as Record<string, string>
      )[error],
      content: { "application/json": { schema: ref("Error") } },
    };
  (spec.paths[path] ??= {})[verb.toLowerCase()] = {
    operationId: `${verb.toLowerCase()}_${url.replace(/[^\w]+/g, "_")}`,
    parameters,
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: z.toJSONSchema(body) } },
          },
        }
      : {}),
    responses,
    ...(media === "text/event-stream"
      ? {
          description:
            "SSE stream with id, event and JSON data frames. Reconnect using Last-Event-ID; heartbeat comments occur every 15 seconds.",
        }
      : {}),
  };
}
