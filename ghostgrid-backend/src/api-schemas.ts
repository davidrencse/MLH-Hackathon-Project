import { z } from "zod";
const id = z.string().uuid();
const name = z.string().trim().min(1).max(160);
const text = z.string().max(100_000);
export const providerSchema = z
  .object({
    name,
    type: z.enum([
      "mock",
      "codex",
      "claude",
      "deepseek",
      "openai-compatible",
      "chatgpt-browser",
      "claude-browser",
      "deepseek-browser",
    ]),
    baseUrl: z.url().optional(),
    model: z.string().min(1).max(200).optional(),
    apiKeyEnv: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .optional(),
    auth: z.enum(["bearer", "none", "header"]).default("bearer"),
    apiKeyHeader: z
      .string()
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
      .max(100)
      .optional(),
    headersEnv: z
      .record(
        z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
        z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
      )
      .optional(),
    queryParameters: z
      .record(z.string().max(100), z.string().max(1000))
      .optional(),
    concurrency: z.number().int().min(1).max(32).default(2),
    timeoutMs: z.number().int().min(10).max(3_600_000).default(300_000),
    parameters: z
      .object({
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().max(1_000_000).optional(),
      })
      .strict()
      .optional(),
    supportsStreaming: z.boolean().default(true),
    supportsModelDiscovery: z.boolean().default(true),
    pricing: z
      .object({
        inputPerMillion: z.number().nonnegative(),
        outputPerMillion: z.number().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const officeProjectSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().max(2_000).default(""),
  })
  .strict();
export const projectSchema = z
  .object({
    name,
    description: text.default(""),
    workspace: z.string().min(1).optional(),
    instructions: text.default(""),
    // Work streams the office assigns employees to. Separate from this record, which is the
    // one top-level project the whole backend is scoped to.
    officeProjects: z.array(officeProjectSchema).max(50).default([]),
  })
  .strict();
export const agentSchema = z
  .object({
    name,
    // Optional on purpose: an API client may create an agent of its own that belongs to no
    // city building. Anything created *for* a building must send that building's id, because
    // it is the only key the city attributes spend by; an omitted one is stored as null and
    // the agent becomes its own building (see Store.agentsForBuilding).
    buildingId: z.string().trim().min(1).max(160).optional(),
    projectId: id,
    providerId: id,
    role: text.default(""),
    // Nullable so an office can hand a repository back: clearing the assignment is a real
    // change, and `undefined` in a PATCH means "leave it alone".
    workspace: z.string().nullable().optional(),
    permissions: z.array(z.enum(["read", "write"])).default(["read"]),
  })
  .strict();
// An office employee is a session: the building's agent is the provider identity, and each
// session is one persistent worker with a role in the org chart.
// A job title is whatever the project's roles call it (see office/roles.ts), so this validates
// shape only; SessionService rejects a title no role defines.
export const officeTitleSchema = z.string().trim().min(1).max(80);
export const officeOrgFields = {
  title: officeTitleSchema.optional(),
  team: z.string().trim().max(80).optional(),
  managerId: id.optional().nullable(),
  officeProjectId: z.string().trim().max(64).optional().nullable(),
  briefNotes: z.string().max(4_000).optional(),
};
export const sessionSchema = z
  .object({
    projectId: id,
    agentId: id,
    name: name.default("New session"),
    ...officeOrgFields,
  })
  .strict();
export const messageSchema = z
  .object({
    prompt: text.min(1),
    title: name.optional(),
    contextIds: z.array(id).max(100).default([]),
    priority: z.number().int().min(-100).max(100).default(0),
    timeoutMs: z.number().int().min(10).max(3_600_000).optional(),
    maxRetries: z.number().int().min(0).max(3).optional(),
  })
  .strict();
export const taskSchema = z
  .object({
    projectId: id,
    agentId: id,
    sessionId: id.optional(),
    title: name.default("Task"),
    prompt: text.min(1),
    priority: z.number().int().min(-100).max(100).default(0),
    dependencies: z.array(id).max(100).default([]),
    contextIds: z.array(id).max(100).default([]),
    timeoutMs: z.number().int().min(10).max(3_600_000).optional(),
    maxRetries: z.number().int().min(0).max(3).optional(),
    // Holds in `awaiting_approval` once its dependencies are done, until POST .../approve.
    requiresApproval: z.boolean().default(false),
  })
  .strict();
export const workflowSchema = z
  .object({
    projectId: id,
    name,
    nodes: z
      .array(
        z
          .object({
            key: z
              .string()
              .regex(/^[\w-]+$/)
              .max(100),
            agentId: id,
            sessionId: id.optional(),
            contextIds: z.array(id).max(100).default([]),
            priority: z.number().int().min(-100).max(100).default(0),
            timeoutMs: z.number().int().min(10).max(3_600_000).optional(),
            maxRetries: z.number().int().min(0).max(3).optional(),
            title: name.optional(),
            prompt: text.min(1),
            dependsOn: z.array(z.string().max(100)).default([]),
            requiresApproval: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const contextSchema = z
  .object({
    title: name,
    content: text,
    sourceTaskId: id.optional(),
    agentId: id.optional(),
    fileReference: z.string().optional(),
  })
  .strict();
export const listSchema = z
  .object({
    buildingId: z.string().max(160).optional(),
    projectId: id.optional(),
    agentId: id.optional(),
    sessionId: id.optional(),
    status: z.string().max(50).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export const cursorSchema = z
  .object({
    after: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(500),
  })
  .strict();
export const eventQuerySchema = cursorSchema.extend({
  taskId: id.optional(),
  sessionId: id.optional(),
  agentId: id.optional(),
  projectId: id.optional(),
});
