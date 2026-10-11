import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
const identity = () => ({
  id: text("id").primaryKey(),
  data: text("data").notNull(),
});
export const projects = sqliteTable("projects", identity());
export const providers = sqliteTable("providers", identity());
export const agents = sqliteTable(
  "agents",
  {
    ...identity(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
  },
  (table) => [index("agents_project_idx").on(table.projectId)],
);
export const sessions = sqliteTable(
  "sessions",
  {
    ...identity(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
  },
  (table) => [index("sessions_agent_idx").on(table.agentId)],
);
export const workflows = sqliteTable("workflows", {
  ...identity(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "restrict" }),
});
export const tasks = sqliteTable(
  "tasks",
  {
    ...identity(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "restrict",
    }),
    workflowId: text("workflow_id").references(() => workflows.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("tasks_project_idx").on(table.projectId),
    index("tasks_session_idx").on(table.sessionId),
    index("tasks_workflow_idx").on(table.workflowId),
    index("tasks_agent_idx").on(table.agentId),
    index("tasks_status_idx").on(sql`json_extract(data,'$.status')`),
  ],
);
export const workflowNodes = sqliteTable("workflow_nodes", {
  ...identity(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "restrict" }),
});
export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    ...identity(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: text("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
  },
  (table) => [
    unique().on(table.taskId, table.dependsOnTaskId),
    index("dependencies_task_idx").on(table.taskId),
  ],
);
export const executionEvents = sqliteTable(
  "execution_events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    taskId: text("task_id").references(() => tasks.id, {
      onDelete: "restrict",
    }),
    data: text("data").notNull(),
  },
  (table) => [
    index("events_task_idx").on(table.taskId, table.seq),
    index("events_session_idx").on(
      sql`json_extract(data,'$.sessionId')`,
      table.seq,
    ),
    index("events_project_idx").on(
      sql`json_extract(data,'$.projectId')`,
      table.seq,
    ),
    index("events_agent_idx").on(
      sql`json_extract(data,'$.agentId')`,
      table.seq,
    ),
  ],
);
export const artifacts = sqliteTable("artifacts", {
  ...identity(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "restrict" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "restrict" }),
});
export const usageRecords = sqliteTable(
  "usage_records",
  {
    ...identity(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("usage_task_idx").on(table.taskId),
    index("usage_created_at_idx").on(sql`json_extract(${table.data},'$.createdAt')`),
  ],
);
export const contextEntries = sqliteTable(
  "context_entries",
  {
    ...identity(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    taskId: text("task_id").references(() => tasks.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [index("contexts_project_idx").on(table.projectId)],
);
