import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export const tables = [
  "projects",
  "providers",
  "agents",
  "sessions",
  "tasks",
  "workflows",
  "workflow_nodes",
  "task_dependencies",
  "execution_events",
  "artifacts",
  "usage_records",
  "context_entries",
] as const;
export type Table = (typeof tables)[number];
export type Entity = Record<string, any> & { id: string };

/** A row as sqlite hands it back: one aggregate, or one group of one. */
type UsageRow = ReturnType<ReturnType<DatabaseSync["prepare"]>["all"]>[number];

/** What `Store.usageSummary` answers. Named so the cache can hold it without self-reference. */
export interface UsageSummary {
  totals: UsageRow;
  today: UsageRow;
  providers: UsageRow[];
  agents: UsageRow[];
  tokensLastMinute: number;
  fetchedAt: string;
  /** Start of the UTC day `today` covers, so a caller can label it. */
  dayStart: string;
}
const columns: Partial<Record<Table, Record<string, string>>> = {
  agents: { projectId: "project_id", providerId: "provider_id" },
  sessions: { projectId: "project_id", agentId: "agent_id" },
  workflows: { projectId: "project_id" },
  tasks: {
    projectId: "project_id",
    agentId: "agent_id",
    sessionId: "session_id",
    workflowId: "workflow_id",
  },
  workflow_nodes: { workflowId: "workflow_id", taskId: "task_id" },
  task_dependencies: {
    taskId: "task_id",
    dependsOnTaskId: "depends_on_task_id",
  },
  execution_events: { taskId: "task_id" },
  artifacts: { projectId: "project_id", taskId: "task_id" },
  usage_records: { taskId: "task_id" },
  context_entries: { projectId: "project_id", taskId: "task_id" },
};
function mappedColumn(table: Table, key: string): string | undefined {
  const mapping = columns[table];
  return mapping && Object.hasOwn(mapping, key) ? mapping[key] : undefined;
}
export class Store {
  readonly db!: DatabaseSync;
  private transactionDepth = 0;
  private releaseLock?: () => void;
  private closed = false;
  // Prepared statements are reusable and the query set here is closed and small, so parsing
  // and planning each one once per process keeps it off every request's path.
  private statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  // `usageSummary` runs five aggregate scans of usage_records joined to tasks, each one
  // json_extract-ing its way across every row: around 13ms at 200 usage rows and 480ms at
  // 20 000, all of it on the single thread that serves every other request. The credits screen
  // asks for it on a timer, so the answer is cached per project, bounded by a short TTL (two of
  // the figures are time-windowed) and dropped as soon as a write could change it.
  private usageCache = new Map<string, { at: number; value: UsageSummary }>();
  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
      path = existsSync(path)
        ? realpathSync(path)
        : resolve(realpathSync(dirname(path)), path.split("/").pop()!);
      this.releaseLock = acquireLock(path);
    }
    try {
      this.db = new DatabaseSync(path);
      this.db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
      );
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
      );
      for (const [version, file] of [
        [1, "0001.sql"],
        [2, "0002.sql"],
        [3, "0003.sql"],
        [4, "0004.sql"],
      ] as const) {
        if (
          !this.db
            .prepare("SELECT version FROM schema_migrations WHERE version=?")
            .get(version)
        )
          this.transaction(() => {
            this.db.exec(
              readFileSync(
                new URL(`./migrations/${file}`, import.meta.url),
                "utf8",
              ),
            );
            this.db
              .prepare("INSERT INTO schema_migrations VALUES(?,?)")
              .run(version, new Date().toISOString());
          });
      }
    } catch (error) {
      try {
        this.db?.close();
      } finally {
        this.releaseLock?.();
      }
      throw error;
    }
  }
  /** Prepare once, reuse forever. Bindings are per call, so sharing a statement is safe. */
  private sql(query: string) {
    let statement = this.statements.get(query);
    if (!statement) {
      statement = this.db.prepare(query);
      this.statements.set(query, statement);
    }
    return statement;
  }
  private table(table: string): asserts table is Table {
    if (!tables.includes(table as Table)) throw new Error("Unknown table");
  }
  get(table: string, id: string): Entity | undefined {
    this.table(table);
    const row = this
      .sql(
        `SELECT data${table === "execution_events" ? ",seq" : ""} FROM ${table} WHERE id=?`,
      )
      .get(id);
    if (!row) return undefined;
    const entity = JSON.parse(row.data as string);
    return table === "execution_events"
      ? { ...entity, seq: Number(row.seq) }
      : entity;
  }
  list(table: string, filters: Record<string, unknown> = {}): Entity[] {
    this.table(table);
    // Push indexed filters into SQLite so unrelated history is never decoded.
    // Keep the final strict comparison for unmapped fields and JS type semantics.
    const clauses: string[] = [];
    const values: string[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value !== "string") continue;
      const column = key === "id" ? "id" : mappedColumn(table, key);
      if (column) {
        clauses.push(`${column}=?`);
        values.push(value);
      } else if (table === "tasks" && key === "status") {
        clauses.push("json_extract(data,'$.status')=?");
        values.push(value);
      }
    }
    return this
      .sql(
        `SELECT data FROM ${table}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY rowid`,
      )
      .all(...values)
      .map((row) => JSON.parse(row.data as string) as Entity)
      .filter((row) =>
        Object.entries(filters).every(
          ([key, value]) => value === undefined || row[key] === value,
        ),
      );
  }
  /** Page supported ownership filters in SQLite; retain strict list semantics otherwise. */
  page(
    table: string,
    filters: Record<string, unknown> = {},
    pagination = { limit: 100, offset: 0 },
  ): { items: Entity[]; total: number } {
    this.table(table);
    const { limit, offset } = pagination;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 0 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error("Invalid pagination");
    const clauses: string[] = [];
    const values: string[] = [];
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) continue;
      if (
        key === "buildingId" &&
        typeof value === "string" &&
        (table === "sessions" || table === "tasks")
      ) {
        // Resolve live building ownership instead of copying a mutable label into history.
        clauses.push(
          "agent_id IN (SELECT id FROM agents WHERE COALESCE(json_extract(data,'$.buildingId'),id)=?)",
        );
        values.push(value);
        continue;
      }
      const column = key === "id" ? "id" : mappedColumn(table, key);
      const expression =
        column ??
        (["tasks", "workflows", "sessions"].includes(table) && key === "status"
          ? "json_extract(data,'$.status')"
          : table === "agents" && key === "buildingId"
            ? "COALESCE(json_extract(data,'$.buildingId'),id)"
            : undefined);
      if (typeof value !== "string" || !expression) {
        const records = this.list(table, filters);
        return {
          items: records.slice(offset, offset + limit),
          total: records.length,
        };
      }
      clauses.push(`${expression}=?`);
      values.push(value);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const total = Number(
      this
        .sql(`SELECT COUNT(*) AS total FROM ${table}${where}`)
        .get(...values)!.total,
    );
    const rows = this
      .sql(
        `SELECT data FROM ${table}${where} ORDER BY rowid LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset);
    return { items: rows.map((row) => JSON.parse(row.data as string)), total };
  }
  /**
   * Every agent that owns one city building, newest last.
   *
   * One rule in one place: a building is claimed by an explicit `buildingId`, and an agent
   * created without one (an API client's own agent) is its own building under its id. The
   * `page` filter, the creation conflict check and the office desk lookup all ask here, so
   * they can never disagree about who owns a building.
   */
  agentsForBuilding(projectId: string, buildingId: string): Entity[] {
    return this
      .sql(
        "SELECT data FROM agents WHERE project_id=? AND COALESCE(json_extract(data,'$.buildingId'),id)=? ORDER BY rowid",
      )
      .all(projectId, buildingId)
      .map((row) => JSON.parse(row.data as string) as Entity);
  }
  usagePage(
    filters: { projectId?: string; agentId?: string },
    limit: number,
    offset: number,
  ): { items: Entity[]; total: number } {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 0 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error("Invalid pagination");
    if (filters.projectId === undefined && filters.agentId === undefined)
      return this.page("usage_records", {}, { limit, offset });
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.projectId !== undefined) {
      clauses.push("t.project_id=?");
      values.push(filters.projectId);
    }
    if (filters.agentId !== undefined) {
      clauses.push("t.agent_id=?");
      values.push(filters.agentId);
    }
    const from = ` FROM usage_records u JOIN tasks t ON t.id=u.task_id${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`;
    const total = Number(
      this.sql(`SELECT COUNT(*) AS total${from}`).get(...values)!.total,
    );
    const rows = this
      .sql(`SELECT u.data${from} ORDER BY u.rowid LIMIT ? OFFSET ?`)
      .all(...values, limit, offset);
    return { items: rows.map((row) => JSON.parse(row.data as string)), total };
  }
  /**
   * Tables whose rows the summary reads. A write to anything else — an event, a session, a task's
   * status — cannot move these numbers, and during a run those are most of the writes, so the
   * cache would never survive long enough to be worth having if they counted.
   *
   * `tasks` is in the list for its project_id and agent_id, which decide which usage rows a
   * filtered summary sees. Inserting a task cannot change a total (it has no usage rows yet), but
   * the row is cheap to be wrong about and task writes are rare next to event writes.
   */
  private static readonly USAGE_SOURCES = new Set(["usage_records", "tasks", "agents", "providers"]);

  private invalidateUsageCache(table: string) {
    if (Store.USAGE_SOURCES.has(table)) this.usageCache.clear();
  }

  /**
   * Holds a summary for at most this long. Two of the figures are windowed on the clock rather
   * than on the data — `today` and `tokensLastMinute` — so even with no writes at all the answer
   * has to be recomputed eventually; a second keeps the live token rate honest.
   */
  private static readonly USAGE_TTL_MS = 1_000;

  usageSummary(projectId?: string): UsageSummary {
    const key = projectId ?? "";
    const cached = this.usageCache.get(key);
    if (cached && Date.now() - cached.at < Store.USAGE_TTL_MS) return cached.value;
    const value = this.computeUsageSummary(projectId);
    this.usageCache.set(key, { at: Date.now(), value });
    return value;
  }

  private computeUsageSummary(projectId?: string): UsageSummary {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    // Usage is grouped two ways because the city asks two different questions of it: which
    // provider was billed, and which agent (so which building) did the spending.
    const GROUPS = {
      provider: {
        columns: ",p.id AS providerId,json_extract(p.data,'$.name') AS name,json_extract(p.data,'$.type') AS type,json_extract(p.data,'$.baseUrl') AS baseUrl",
        join: "LEFT JOIN providers p ON p.id=json_extract(u.data,'$.providerId')",
        by: "p.id",
      },
      // `buildingId` stays null for an agent that belongs to no city building: the caller
      // needs to tell "this building spent it" apart from "nothing claims this spend".
      // Every row still carries `agentId` and a name, so unattributed tokens can be shown
      // as unassigned instead of being dropped on the floor.
      agent: {
        columns: ",t.agent_id AS agentId,COALESCE(json_extract(a.data,'$.name'),t.agent_id) AS name,json_extract(a.data,'$.buildingId') AS buildingId",
        join: "LEFT JOIN agents a ON a.id=t.agent_id",
        by: "t.agent_id",
      },
    } as const;
    const aggregate = (since?: string, group?: keyof typeof GROUPS) => {
      const clauses: string[] = [];
      const values: string[] = [];
      const by = group ? GROUPS[group] : null;
      if (projectId) { clauses.push("t.project_id=?"); values.push(projectId); }
      if (since) { clauses.push("json_extract(u.data,'$.createdAt')>=?"); values.push(since); }
      return this.sql(`SELECT
        COUNT(*) AS requests,
        COALESCE(SUM(json_extract(u.data,'$.inputTokens')),0) AS inputTokens,
        COALESCE(SUM(json_extract(u.data,'$.outputTokens')),0) AS outputTokens,
        -- Cache reads are counted inside inputTokens by every adapter that reports them, so this
        -- is reported alongside rather than added: it says how much of the input was not fresh.
        COALESCE(SUM(json_extract(u.data,'$.cachedInputTokens')),0) AS cachedInputTokens,
        COALESCE(SUM(json_extract(u.data,'$.costUsd')),0) AS reportedCostUsd,
        COALESCE(SUM(CASE WHEN json_extract(u.data,'$.costUsd') IS NULL THEN json_extract(u.data,'$.estimatedCostUsd') ELSE 0 END),0) AS estimatedCostUsd,
        COALESCE(SUM(CASE WHEN json_extract(u.data,'$.costUsd') IS NULL AND json_extract(u.data,'$.estimatedCostUsd') IS NULL THEN 1 ELSE 0 END),0) AS unknownCostRequests,
        COALESCE(SUM(CASE WHEN json_extract(u.data,'$.inputTokens') IS NULL OR json_extract(u.data,'$.outputTokens') IS NULL THEN 1 ELSE 0 END),0) AS unknownTokenRequests
        ${by?.columns ?? ""}
        FROM usage_records u JOIN tasks t ON t.id=u.task_id
        ${by?.join ?? ""}
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ${by ? `GROUP BY ${by.by}` : ""}`).all(...values);
    };
    const minute = aggregate(new Date(now.getTime() - 60_000).toISOString())[0];
    return {
      totals: aggregate()[0],
      today: aggregate(today)[0],
      providers: aggregate(undefined, "provider"),
      agents: aggregate(undefined, "agent"),
      tokensLastMinute: Number(minute.inputTokens) + Number(minute.outputTokens),
      fetchedAt: now.toISOString(),
      dayStart: today,
    };
  }
  taskCountsBySession(
    sessionIds: string[],
  ): Map<string, Record<string, number>> {
    const counts = new Map<string, Record<string, number>>();
    const ids = [...new Set(sessionIds)];
    for (let start = 0; start < ids.length; start += 500) {
      const batch = ids.slice(start, start + 500);
      for (const row of this
        .sql(
          `SELECT session_id AS sessionId,json_extract(data,'$.status') AS status,COUNT(*) AS count FROM tasks WHERE session_id IN (${batch.map(() => "?").join(",")}) GROUP BY session_id,json_extract(data,'$.status')`,
        )
        .all(...batch)) {
        const statuses = counts.get(String(row.sessionId)) ?? {};
        statuses[String(row.status)] = Number(row.count);
        counts.set(String(row.sessionId), statuses);
      }
    }
    return counts;
  }
  metrics(
    limit = 100,
    offset = 0,
  ): {
    tasks: Record<string, number>;
    activeAgents: number;
    workflowCompletionRate: number | null;
    durations: { taskId: string; durationMs: number }[];
    durationsTotal: number;
    durationLimit: number;
    durationOffset: number;
  } {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error("Invalid metrics pagination");
    const tasks: Record<string, number> = Object.fromEntries(
      [
        "pending",
        "queued",
        "running",
        "awaiting_approval",
        "completed",
        "failed",
        "cancelled",
      ].map((status) => [status, 0]),
    );
    for (const row of this
      .sql(
        "SELECT json_extract(data,'$.status') AS status,COUNT(*) AS count FROM tasks GROUP BY json_extract(data,'$.status')",
      )
      .all())
      if (Object.hasOwn(tasks, String(row.status)))
        tasks[String(row.status)] = Number(row.count);
    const activeAgents = Number(
      this
        .sql(
          "SELECT COUNT(DISTINCT agent_id) AS count FROM tasks WHERE json_extract(data,'$.status')='running'",
        )
        .get()!.count,
    );
    const completion = this
      .sql(
        "SELECT AVG(CASE WHEN json_extract(data,'$.status')='completed' THEN 1.0 ELSE 0.0 END) AS rate FROM workflows WHERE json_extract(data,'$.status') IN ('completed','failed','cancelled')",
      )
      .get()!.rate;
    const durationWhere =
      "json_extract(data,'$.startedAt') IS NOT NULL AND json_extract(data,'$.startedAt') != '' AND json_extract(data,'$.completedAt') IS NOT NULL AND json_extract(data,'$.completedAt') != ''";
    const durationsTotal = Number(
      this
        .sql(`SELECT COUNT(*) AS total FROM tasks WHERE ${durationWhere}`)
        .get()!.total,
    );
    const durations = this
      .sql(
        `SELECT id,json_extract(data,'$.startedAt') AS startedAt,json_extract(data,'$.completedAt') AS completedAt FROM tasks WHERE ${durationWhere} ORDER BY rowid LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
      .map((row) => ({
        taskId: String(row.id),
        durationMs:
          Date.parse(String(row.completedAt)) -
          Date.parse(String(row.startedAt)),
      }));
    return {
      tasks,
      activeAgents,
      workflowCompletionRate: completion === null ? null : Number(completion),
      durations,
      durationsTotal,
      durationLimit: limit,
      durationOffset: offset,
    };
  }
  insert(table: string, data: Record<string, any>): Entity {
    this.table(table);
    const now = new Date().toISOString();
    const value = {
      createdAt: now,
      updatedAt: now,
      ...data,
      id: data.id ?? randomUUID(),
    } as Entity;
    const mapping = columns[table] ?? {};
    const names = ["id", ...Object.values(mapping), "data"];
    const values = [
      value.id,
      ...Object.keys(mapping).map((key) => value[key] ?? null),
      JSON.stringify(value),
    ];
    this
      .sql(
        `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
      )
      .run(...values);
    this.invalidateUsageCache(table);
    return value;
  }
  update(table: string, id: string, patch: Record<string, any>): Entity {
    this.table(table);
    const previous = this.get(table, id);
    if (!previous)
      throw Object.assign(new Error("Record not found"), { statusCode: 404 });
    const value: Entity = {
      ...previous,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    const mapping = columns[table] ?? {};
    this
      .sql(
        `UPDATE ${table} SET ${[...Object.values(mapping).map((name) => `${name}=?`), "data=?"].join(",")} WHERE id=?`,
      )
      .run(
        ...Object.keys(mapping).map((key) => value[key] ?? null),
        JSON.stringify(value),
        id,
      );
    this.invalidateUsageCache(table);
    return value;
  }
  delete(table: string, id: string): boolean {
    this.table(table);
    const deleted = this.sql(`DELETE FROM ${table} WHERE id=?`).run(id).changes > 0;
    if (deleted) this.invalidateUsageCache(table);
    return deleted;
  }
  transaction<T>(fn: () => T): T {
    const depth = this.transactionDepth;
    const name = `nested_${depth}`;
    this.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
    this.transactionDepth++;
    try {
      const result = fn();
      if (
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        typeof (result as { then?: unknown }).then === "function"
      )
        throw new Error("SQLite transactions require synchronous callbacks");
      this.db.exec(depth === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      this.db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO SAVEPOINT ${name}`);
      if (depth !== 0) this.db.exec(`RELEASE SAVEPOINT ${name}`);
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  event(
    type: string,
    taskId: string | null,
    data: unknown,
    identifiers: Record<string, unknown> = {},
  ): Entity {
    return this.transaction(() => {
      const event = this.insert("execution_events", {
        ...identifiers,
        type,
        taskId,
        data,
        timestamp: new Date().toISOString(),
      });
      const seq = Number(
        this
          .sql("SELECT seq FROM execution_events WHERE id=?")
          .get(event.id)!.seq,
      );
      return this.update("execution_events", event.id, { seq });
    });
  }
  /**
   * Highest sequence number currently stored, optionally for one filtered slice.
   *
   * A client that wants to stream from "now" needs this in one call; paging
   * forward to find the end costs a round trip per 1000 events of history.
   */
  latestEventSeq(
    filters: {
      taskId?: string;
      sessionId?: string;
      projectId?: string;
      agentId?: string;
    } = {},
  ): number {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (filters.taskId !== undefined) {
      clauses.push("task_id=?");
      values.push(filters.taskId);
    }
    for (const key of ["sessionId", "projectId", "agentId"] as const)
      if (filters[key] !== undefined) {
        clauses.push(`json_extract(data,'$.${key}')=?`);
        values.push(filters[key]!);
      }
    const row = this
      .sql(
        `SELECT MAX(seq) AS seq FROM execution_events${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`,
      )
      .get(...values) as { seq: number | null } | undefined;
    return Number(row?.seq ?? 0);
  }
  events(
    after = 0,
    taskId?: string,
    limit = 1000,
    filters: { sessionId?: string; projectId?: string; agentId?: string } = {},
  ): Entity[] {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 0
    )
      throw new Error("Invalid event pagination");
    const clauses = ["seq>?"];
    const values: (string | number)[] = [after];
    if (taskId) {
      clauses.push("task_id=?");
      values.push(taskId);
    }
    for (const key of ["sessionId", "projectId", "agentId"] as const)
      if (filters[key] !== undefined) {
        clauses.push(`json_extract(data,'$.${key}')=?`);
        values.push(filters[key]!);
      }
    const rows = this
      .sql(
        `SELECT data,seq FROM execution_events WHERE ${clauses.join(" AND ")} ORDER BY seq LIMIT ?`,
      )
      .all(...values, limit);
    // Read the authoritative sequence column, including old events interrupted before JSON enrichment.
    return rows.map((row) => ({
      ...JSON.parse(row.data as string),
      seq: Number(row.seq),
    }));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.statements.clear();
      this.db.close();
    } finally {
      this.releaseLock?.();
    }
  }
}

/** Serialize startup/recovery so concurrent processes cannot both replace a stale lock. */
function acquireLock(databasePath: string): () => void {
  const lock = `${databasePath}.lock`,
    guard = `${lock}.guard`,
    token = randomUUID();
  try {
    mkdirSync(guard);
  } catch {
    throw new Error(
      "Database lock acquisition is already in progress; inspect the .lock.guard directory if a previous startup crashed",
    );
  }
  try {
    let owner: { pid: number; token: string } | undefined;
    try {
      owner = JSON.parse(readFileSync(lock, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Database lock is malformed; manual inspection is required",
        );
    }
    if (owner) {
      if (
        !Number.isSafeInteger(owner.pid) ||
        owner.pid < 1 ||
        typeof owner.token !== "string" ||
        !owner.token
      )
        throw new Error(
          "Database lock is malformed; manual inspection is required",
        );
      let alive = true;
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw new Error(
          `Database is already owned by running process ${owner.pid}`,
        );
      unlinkSync(lock);
    }
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), {
      flag: "wx",
      mode: 0o600,
    });
  } finally {
    rmdirSync(guard);
  }
  return () => {
    // Shutdown must not fail because the lock was already removed or rewritten
    // by an operator: only this process's own lock is cleaned up.
    try {
      const owner = JSON.parse(readFileSync(lock, "utf8"));
      if (owner.pid === process.pid && owner.token === token) unlinkSync(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
  };
}
