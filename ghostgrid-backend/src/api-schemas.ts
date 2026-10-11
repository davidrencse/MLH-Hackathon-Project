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
export const projectSchema = z
  .object({
    name,
    description: text.default(""),
    workspace: z.string().min(1).optional(),
    instructions: text.default(""),
  })
  .strict();
export const agentSchema = z
  .object({
    name,
    buildingId: z.string().trim().min(1).max(160).optional(),
    projectId: id,
    providerId: id,
    role: text.default(""),
    workspace: z.string().optional(),
    permissions: z.array(z.enum(["read", "write"])).default(["read"]),
  })
  .strict();
export const sessionSchema = z
  .object({ projectId: id, agentId: id, name: name.default("New session") })
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
