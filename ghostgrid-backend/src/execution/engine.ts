import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, realpath, stat, unlink } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redact, safeError } from "../security/index.js";
const runFile = promisify(execFile);

type Row = Record<string, any>;
interface Storage {
  get(table: string, id: string): Row | undefined;
  list(table: string, filter?: Record<string, unknown>): Row[];
  insert(table: string, row: Row): Row;
  update(table: string, id: string, patch: Row): Row;
  transaction<T>(fn: () => T): T;
  event(
    type: string,
    taskId: string | null,
    data: unknown,
    identifiers?: Row,
  ): Row;
}
interface Registry {
  get(config: any): any;
}
export interface EngineOptions {
  concurrency?: number;
  artifactsDir: string;
  allowedWorkspaces: string[];
  providerConcurrency?: number;
  taskTimeoutMs?: number;
  maxRetries?: number;
}
const terminal = new Set(["completed", "failed", "cancelled"]);
const now = () => new Date().toISOString();
const invalid = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

/** Durable local scheduler. Interrupted executions fail rather than replaying side effects. */
export class Engine {
  readonly emitter = new EventEmitter();
  private active = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<void>;
      session?: string;
      workspace?: string;
      provider: string;
    }
  >();
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private notificationFrames: Row[][] = [];
  constructor(
    private store: Storage,
    private registry: Registry,
    private options: EngineOptions,
  ) {}

  /** Publish committed events without allowing observers to break execution. */
  publishEvent(event: Row) {
    const frame = this.notificationFrames.at(-1);
    if (frame) {
      frame.push(event);
      return;
    }
    for (const listener of this.emitter.rawListeners("event")) {
      try {
        listener.call(this.emitter, event);
      } catch {
        // A disconnected observer can retrieve the durable event on reconnect.
      }
    }
  }
  private transaction<T>(fn: () => T): T {
    const events: Row[] = [];
    this.notificationFrames.push(events);
    let result: T;
    try {
      result = this.store.transaction(fn);
    } catch (error) {
      this.notificationFrames.pop();
      throw error;
    }
    this.notificationFrames.pop();
    for (const event of events) this.publishEvent(event);
    return result;
  }
  event(task: Row, type: string, data: Row = {}) {
    const event = this.store.event(type, task.id, redact(data), {
      sessionId: task.sessionId ?? null,
      agentId: task.agentId,
      projectId: task.projectId,
    });
    this.publishEvent(event);
    return event;
  }
  start() {
    if (this.timer) return;
    this.stopping = false;
    for (const task of this.store.list("tasks"))
      if (["running", "awaiting_approval"].includes(task.status)) {
        this.finish(task, "failed", {
          error: {
            code: "EXECUTION_INTERRUPTED",
            message:
              "Backend restarted during execution. Review side effects before submitting a new task.",
          },
        });
      }
    // Older versions could persist final tasks before their workflow summary.
    for (const workflow of this.store.list("workflows", { status: "running" }))
      this.refreshWorkflow(workflow.id);
    this.timer = setInterval(() => this.pump(), 25);
    this.timer.unref();
    this.pump();
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const execution of this.active.values())
      execution.controller.abort(new Error("Backend shutting down"));
    await Promise.allSettled([...this.active.values()].map((x) => x.promise));
  }
  submitTask(data: Row) {
    const agent = this.store.get("agents", data.agentId);
    if (!agent || agent.projectId !== data.projectId)
      throw invalid("Agent must belong to the task project");
    if (!this.store.get("projects", data.projectId))
      throw invalid("Project not found", 404);
    if (data.sessionId) {
      const session = this.store.get("sessions", data.sessionId);
      if (!session || session.agentId !== agent.id)
        throw invalid("Session must belong to the selected agent");
      if (session.status === "archived")
        throw invalid(
          "Resume the archived session before submitting a task",
          409,
        );
    }
    for (const id of data.dependencies ?? []) {
      const dependency = this.store.get("tasks", id);
      if (!dependency || dependency.projectId !== data.projectId)
        throw invalid("Dependencies must belong to the same project");
    }
    for (const id of data.contextIds ?? [])
      if (this.store.get("context_entries", id)?.projectId !== data.projectId)
        throw Object.assign(
          new Error("Context must exist and belong to the task project"),
          { statusCode: 400 },
        );
    const task = this.transaction(() => {
      if (!data.sessionId) {
        data = {
          ...data,
          sessionId: this.store.insert("sessions", {
            projectId: data.projectId,
            agentId: data.agentId,
            name: data.title ?? "New session",
            status: "active",
            messages: [],
            memory: "",
          }).id,
        };
        const sessionEvent = this.store.event(
          "session.created",
          null,
          { id: data.sessionId },
          {
            sessionId: data.sessionId,
            agentId: data.agentId,
            projectId: data.projectId,
          },
        );
        this.publishEvent(sessionEvent);
      }
      const row = this.store.insert(
        "tasks",
        redact({
          projectId: data.projectId,
          agentId: data.agentId,
          sessionId: data.sessionId,
          workflowId: data.workflowId,
          title: data.title ?? "Task",
          prompt: data.prompt,
          contextIds: data.contextIds ?? [],
          timeoutMs: data.timeoutMs ?? this.options.taskTimeoutMs,
          maxRetries: data.maxRetries ?? this.options.maxRetries ?? 0,
          id: randomUUID(),
          status: "queued",
          priority: data.priority ?? 0,
          createdAt: now(),
          attempts: 0,
          result: null,
          error: null,
          usage: null,
        }),
      );
      for (const dependsOnTaskId of data.dependencies ?? [])
        this.store.insert("task_dependencies", {
          id: randomUUID(),
          taskId: row.id,
          dependsOnTaskId,
        });
      this.event(row, "task.created");
      this.event(row, "task.queued");
      return row;
    });
    return task;
  }
  cancelTask(id: string) {
    const task = this.store.get("tasks", id);
    if (!task) throw invalid("Task not found", 404);
    if (terminal.has(task.status)) return task;
    const result = this.finish(task, "cancelled");
    // Stop side effects only after the terminal transition is durable.
    this.active.get(id)?.controller.abort(new Error("Task cancelled"));
    return result;
  }
  private finish(task: Row, status: string, patch: Row = {}) {
    const current = this.store.get("tasks", task.id);
    if (!current || terminal.has(current.status)) return current;
    const { result, event } = this.transaction(() => {
      const result = this.store.update("tasks", task.id, {
        ...redact(patch),
        status,
        completedAt: now(),
      });
      const event = this.store.event(`task.${status}`, task.id, redact(patch), {
        sessionId: result.sessionId ?? null,
        agentId: result.agentId,
        projectId: result.projectId,
      });
      if (result.workflowId) this.refreshWorkflow(result.workflowId);
      return { result, event };
    });
    // Observers must only see transitions once their durable state is committed.
    this.publishEvent(event);
    return result;
  }
  private dependencies(task: Row) {
    return this.store
      .list("task_dependencies", { taskId: task.id })
      .map((x) => this.store.get("tasks", x.dependsOnTaskId));
  }
  private pump() {
    if (this.stopping) return;
    const tasks = [
      ...this.store.list("tasks", { status: "pending" }),
      ...this.store.list("tasks", { status: "queued" }),
    ].sort(
      (a, b) =>
        b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
    );
    for (const task of tasks) {
      // Event listeners can cancel other tasks while this scheduling snapshot is processed.
      if (
        !["pending", "queued"].includes(
          this.store.get("tasks", task.id)?.status,
        )
      )
        continue;
      if (task.retryAt && Date.parse(task.retryAt) > Date.now()) continue;
      const deps = this.dependencies(task);
      if (deps.some((d) => !d || ["failed", "cancelled"].includes(d.status))) {
        this.finish(task, "failed", {
          error: {
            code: "DEPENDENCY_FAILED",
            message: "A required task did not complete successfully",
          },
        });
        continue;
      }
      if (deps.some((d) => d?.status !== "completed")) continue;
      if (this.active.size >= (this.options.concurrency ?? 2)) break;
      const agent = this.store.get("agents", task.agentId);
      if (!agent) {
        this.finish(task, "failed", {
          error: { code: "AGENT_MISSING", message: "Agent no longer exists" },
        });
        continue;
      }
      const workspace =
        agent.workspace ??
        this.store.get("projects", task.projectId)?.workspace;
      if (
        [...this.active.values()].some(
          (x) =>
            (task.sessionId && x.session === task.sessionId) ||
            (workspace && x.workspace === workspace),
        )
      )
        continue;
      if (
        [...this.active.values()].filter((x) => x.provider === agent.providerId)
          .length >=
        (this.store.get("providers", agent.providerId)?.concurrency ??
          this.options.providerConcurrency ??
          2)
      )
        continue;
      const controller = new AbortController();
      this.store.update("tasks", task.id, {
        status: "running",
        startedAt: now(),
        attempts: (task.attempts ?? 0) + 1,
      });
      const promise = Promise.resolve()
        .then(() => this.execute(task, agent, controller))
        .finally(() => {
          this.active.delete(task.id);
          this.pump();
        });
      this.active.set(task.id, {
        controller,
        promise,
        workspace,
        session: task.sessionId,
        provider: agent.providerId,
      });
    }
  }
  private async workspace(path?: string) {
    if (!path) return undefined;
    const canonical = await realpath(resolve(path));
    for (const allowed of this.options.allowedWorkspaces) {
      const rel = relative(await realpath(resolve(allowed)), canonical);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
        return canonical;
    }
    throw invalid("Workspace is outside configured allowlist");
  }
  private async execute(task: Row, agent: Row, controller: AbortController) {
    let timeout: NodeJS.Timeout | undefined;
    let timedOut = false;
    let pendingArtifactPath: string | undefined;
    try {
      const config = this.store.get("providers", agent.providerId);
      if (!config) throw invalid("Provider not found");
      if (controller.signal.aborted) throw controller.signal.reason;
      timeout = setTimeout(
        () => {
          timedOut = true;
          controller.abort(new Error("Task timed out"));
        },
        Math.min(task.timeoutMs ?? config.timeoutMs ?? 300000, 3600000),
      );
      const adapter = this.registry.get(config);
      const session = task.sessionId
        ? this.store.get("sessions", task.sessionId)
        : undefined;
      if (
        session &&
        (session.agentId !== agent.id || session.projectId !== task.projectId)
      )
        throw invalid("Session ownership changed during execution");
      let workspace = await this.workspace(
        agent.workspace ??
          this.store.get("projects", task.projectId)?.workspace,
      );
      const deps = this.dependencies(task);
      // A reviewer must inspect the implementation worktree, not the unchanged source tree.
      const producedWorkspace = deps
        .map((x) => x?.workspace)
        .find(
          (path: unknown) =>
            typeof path === "string" &&
            path.startsWith(
              resolve(this.options.artifactsDir, "workspaces") + "/",
            ),
        );
      if (producedWorkspace && !(agent.permissions ?? []).includes("write"))
        workspace = producedWorkspace;
      // Persist the effective read workspace as well: downstream reviewers must
      // follow the same implementation tree through intermediate review tasks.
      if (workspace && !(agent.permissions ?? []).includes("write"))
        this.store.update("tasks", task.id, { workspace });
      if ((agent.permissions ?? []).includes("write")) {
        if (!workspace)
          throw invalid("Writing agents require an allowlisted Git workspace");
        if (session?.workspace) {
          const isolatedRoot = await realpath(
            resolve(this.options.artifactsDir, "workspaces"),
          );
          const reused = await realpath(session.workspace);
          const rel = relative(isolatedRoot, reused);
          if (
            !rel ||
            rel === ".." ||
            rel.startsWith("../") ||
            isAbsolute(rel) ||
            !(await stat(resolve(reused, ".git"))).isFile()
          )
            throw invalid(
              "Stored session workspace is not an owned isolated Git worktree",
            );
          const worktrees = await runFile(
            "git",
            ["-C", workspace, "worktree", "list", "--porcelain"],
            { signal: controller.signal },
          );
          if (!worktrees.stdout.split("\n").includes(`worktree ${reused}`))
            throw invalid(
              "Session workspace does not belong to its project repository",
            );
          workspace = reused;
          this.store.update("tasks", task.id, { workspace });
        } else {
          const status = await runFile(
            "git",
            ["-C", workspace, "status", "--porcelain"],
            { signal: controller.signal },
          );
          if (status.stdout.trim())
            throw invalid(
              "Writing agents require a clean Git workspace; commit existing changes before running",
            );
          const isolated = resolve(
            this.options.artifactsDir,
            "workspaces",
            task.id,
          );
          await mkdir(resolve(this.options.artifactsDir, "workspaces"), {
            recursive: true,
          });
          await runFile(
            "git",
            ["-C", workspace, "worktree", "add", "--detach", isolated, "HEAD"],
            { signal: controller.signal },
          );
          workspace = isolated;
          this.store.update("tasks", task.id, { workspace: isolated });
          if (session)
            this.store.update("sessions", session.id, { workspace: isolated });
          this.event(task, "agent.workspace.created", {
            path: isolated,
            integrationRequired: true,
          });
        }
      }
      this.event(task, "task.started");
      const contexts = this.store
        .list("context_entries", { projectId: task.projectId })
        .filter((x) => (task.contextIds ?? []).includes(x.id));
      const handoff = deps.length
        ? "\n\nCompleted dependency outputs:\n" +
          JSON.stringify(
            deps.map((x) => ({ taskId: x!.id, output: x!.result })),
          )
        : "";
      const context = contexts.length
        ? "\n\nExplicit project context:\n" +
          JSON.stringify(
            contexts.map((x) => ({ id: x.id, content: x.content })),
          )
        : "";
      const sessionConfig = createHash("sha256")
        .update(
          JSON.stringify({
            providerId: config.id,
            type: config.type,
            model: config.model ?? null,
            baseUrl: config.baseUrl ?? null,
            apiKeyEnv: config.apiKeyEnv ?? null,
            workspace: workspace ?? null,
          }),
        )
        .digest("hex");
      let nativeSessionId = session?.providerSessionId;
      let streamedOutputSize = 0;
      const emit = (type: string, data: unknown) => {
        // Adapters own agent progress only; task/session lifecycle belongs to this engine.
        if (!/^agent\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/.test(type))
          throw invalid("Provider emitted an invalid agent event type");
        if (type === "agent.output") {
          const text = (data as Row | null)?.text;
          if (typeof text !== "string")
            throw invalid("Provider output events must contain text");
          streamedOutputSize += text.length;
          if (streamedOutputSize > 8_000_000)
            throw invalid(
              "Provider streamed output exceeds the 8000000-character limit",
            );
        }
        if (!terminal.has(this.store.get("tasks", task.id)?.status)) {
          if (type === "agent.session.recovered" && session)
            this.store.update("sessions", session.id, {
              providerSessionId: null,
              providerSessionConfig: sessionConfig,
              lastRecovery: { reason: (data as Row)?.reason, at: now() },
            });
          const nativeId = (data as Row | null)?.sessionId;
          if (
            type === "agent.connected" &&
            nativeId !== undefined &&
            (typeof nativeId !== "string" ||
              !nativeId ||
              nativeId.length > 1024)
          )
            throw invalid(
              "Provider event contains an invalid session identifier",
            );
          if (
            type === "agent.connected" &&
            session &&
            typeof nativeId === "string" &&
            nativeId
          )
            this.store.update("sessions", session.id, {
              providerSessionId: nativeId,
              providerSessionConfig: sessionConfig,
            });
          this.event(task, type, (data ?? {}) as Row);
        }
      };
      if (
        nativeSessionId &&
        session?.providerSessionConfig &&
        session.providerSessionConfig !== sessionConfig
      ) {
        nativeSessionId = undefined;
        emit("agent.session.recovered", {
          reason: "provider_configuration_changed",
        });
      }
      const project = this.store.get("projects", task.projectId);
      const prompt = redact(
        [
          project?.instructions,
          agent.role,
          session?.memory ? `Saved session notes:\n${session.memory}` : "",
          task.prompt + context + handoff,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      if (prompt.length > 128_000)
        throw invalid(
          "Selected prompt, instructions, context and dependency outputs exceed the 128000-character budget; select fewer context sources",
        );
      const messages: Row[] = [];
      let historySize = 0;
      for (const message of [...(session?.messages ?? [])]
        .slice(-20)
        .reverse()) {
        if (
          typeof message.content !== "string" ||
          historySize + message.content.length > 32_000
        )
          break;
        messages.unshift(message);
        historySize += message.content.length;
      }
      // Workspace setup and synchronous event listeners can cancel this task.
      controller.signal.throwIfAborted();
      const result = redact(
        await adapter.executeTask(
          {
            taskId: task.id,
            prompt,
            workspace,
            sessionId: nativeSessionId,
            messages: redact(messages),
            signal: controller.signal,
            agent,
          },
          emit,
        ),
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!result || typeof result.output !== "string")
        throw invalid("Provider result must contain a string output");
      if (result.output.length > 8_000_000)
        throw invalid("Provider output exceeds the 8000000-character limit");
      if (
        result.sessionId !== undefined &&
        (typeof result.sessionId !== "string" ||
          !result.sessionId ||
          result.sessionId.length > 1024)
      )
        throw invalid("Provider result contains an invalid session identifier");
      if (session)
        this.store.update("sessions", session.id, {
          providerSessionId:
            result.sessionId ??
            this.store.get("sessions", session.id)?.providerSessionId,
          providerSessionConfig: sessionConfig,
          updatedAt: now(),
          messages: redact([
            ...(session.messages ?? []),
            { role: "user", content: task.prompt },
            { role: "assistant", content: result.output },
          ]),
        });
      const knownNumber = (value: unknown): value is number =>
        typeof value === "number" && Number.isFinite(value) && value >= 0;
      const inputTokens = knownNumber(result.usage?.inputTokens)
        ? result.usage.inputTokens
        : null;
      const outputTokens = knownNumber(result.usage?.outputTokens)
        ? result.usage.outputTokens
        : null;
      const costUsd = knownNumber(result.usage?.costUsd)
        ? result.usage.costUsd
        : null;
      const pricing = config.pricing;
      const estimate =
        inputTokens !== null &&
        outputTokens !== null &&
        knownNumber(pricing?.inputPerMillion) &&
        knownNumber(pricing?.outputPerMillion)
          ? (inputTokens * pricing.inputPerMillion +
              outputTokens * pricing.outputPerMillion) /
            1_000_000
          : null;
      const estimatedCostUsd =
        estimate !== null && Number.isFinite(estimate) ? estimate : null;
      const usage = {
        inputTokens,
        outputTokens,
        costUsd,
        estimatedCostUsd,
        costSource:
          costUsd !== null
            ? "reported"
            : estimatedCostUsd !== null
              ? "estimated"
              : "unknown",
      };
      this.store.insert("usage_records", {
        id: randomUUID(),
        taskId: task.id,
        agentId: agent.id,
        providerId: agent.providerId,
        projectId: task.projectId,
        createdAt: now(),
        ...usage,
      });
      this.event(task, "usage.updated", usage);
      controller.signal.throwIfAborted();
      await mkdir(this.options.artifactsDir, { recursive: true });
      controller.signal.throwIfAborted();
      const artifactId = randomUUID();
      const path = resolve(this.options.artifactsDir, artifactId + ".txt");
      pendingArtifactPath = path;
      await writeFile(
        path,
        typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output),
        { mode: 0o600 },
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      this.transaction(() => {
        this.store.insert("artifacts", {
          id: artifactId,
          taskId: task.id,
          projectId: task.projectId,
          agentId: agent.id,
          name: "output.txt",
          path: artifactId + ".txt",
          mimeType: "text/plain",
          createdAt: now(),
        });
        this.finish(task, "completed", { result: result.output, usage });
      });
      pendingArtifactPath = undefined;
    } catch (error: any) {
      const current = this.store.get("tasks", task.id);
      if (current && !terminal.has(current.status)) {
        const provider = this.store.get("providers", agent.providerId);
        const inference =
          [
            "deepseek",
            "openai-compatible",
            "mock",
            "chatgpt-browser",
            "claude-browser",
            "deepseek-browser",
          ].includes(provider?.type) &&
          !(agent.permissions ?? []).includes("write");
        if (
          !controller.signal.aborted &&
          inference &&
          error?.transient === true &&
          current.attempts <= Math.min(task.maxRetries ?? 0, 3)
        ) {
          this.store.update("tasks", task.id, {
            status: "queued",
            retryAt: new Date(
              Date.now() + 250 * 2 ** (current.attempts - 1),
            ).toISOString(),
          });
          this.event(task, "task.queued", { retry: current.attempts });
        } else
          this.finish(task, "failed", {
            error: {
              code: timedOut ? "TASK_TIMEOUT" : "EXECUTION_FAILED",
              ...safeError(error),
            },
          });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (pendingArtifactPath) {
        try {
          await unlink(pendingArtifactPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            this.event(task, "artifact.cleanup.failed", safeError(error));
        }
      }
    }
  }
  createWorkflow(data: Row) {
    const nodes: Row[] = data.nodes ?? [];
    if (!nodes.length) throw invalid("Workflow requires nodes");
    const keys = new Set(nodes.map((n) => n.key));
    if (keys.size !== nodes.length)
      throw invalid("Duplicate workflow node keys");
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (key: string) => {
      if (visiting.has(key))
        throw invalid("Workflow contains a dependency cycle");
      if (visited.has(key)) return;
      visiting.add(key);
      for (const dep of nodes.find((n) => n.key === key)!.dependsOn ?? []) {
        if (!keys.has(dep)) throw invalid("Unknown workflow dependency");
        visit(dep);
      }
      visiting.delete(key);
      visited.add(key);
    };
    for (const node of nodes) {
      const agent = this.store.get("agents", node.agentId);
      if (!agent || agent.projectId !== data.projectId)
        throw invalid("Workflow agent must belong to project");
      if (node.sessionId) {
        const session = this.store.get("sessions", node.sessionId);
        if (
          !session ||
          session.agentId !== agent.id ||
          session.projectId !== data.projectId
        )
          throw invalid(
            "Workflow session must belong to the selected agent and project",
          );
        if (session.status === "archived")
          throw invalid(
            "Resume the archived session before using it in a workflow",
            409,
          );
      }
      for (const contextId of node.contextIds ?? [])
        if (
          this.store.get("context_entries", contextId)?.projectId !==
          data.projectId
        )
          throw invalid("Workflow context must belong to its project");
      visit(node.key);
    }
    return this.transaction(() => {
      const workflow = this.store.insert("workflows", {
        id: randomUUID(),
        projectId: data.projectId,
        name: data.name,
        status: "pending",
        createdAt: now(),
      });
      for (const node of nodes)
        this.store.insert("workflow_nodes", {
          ...redact(node),
          id: randomUUID(),
          workflowId: workflow.id,
        });
      return workflow;
    });
  }
  runWorkflow(id: string) {
    const workflow = this.store.get("workflows", id);
    if (!workflow) throw invalid("Workflow not found", 404);
    if (workflow.status !== "pending")
      throw invalid("Workflow has already been run", 409);
    return this.transaction(() => {
      const nodes = this.store.list("workflow_nodes", { workflowId: id });
      const tasks = new Map<string, Row>();
      for (const node of nodes) {
        const task = this.submitTask({
          projectId: workflow.projectId,
          agentId: node.agentId,
          prompt: node.prompt,
          title: node.title ?? node.key,
          workflowId: id,
          sessionId: node.sessionId,
          contextIds: node.contextIds,
          priority: node.priority,
          timeoutMs: node.timeoutMs,
          maxRetries: node.maxRetries,
        });
        tasks.set(node.key, task);
        this.store.update("workflow_nodes", node.id, { taskId: task.id });
      }
      for (const node of nodes)
        for (const key of node.dependsOn ?? [])
          this.store.insert("task_dependencies", {
            id: randomUUID(),
            taskId: tasks.get(node.key)!.id,
            dependsOnTaskId: tasks.get(key)!.id,
          });
      return this.store.update("workflows", id, {
        status: "running",
        startedAt: now(),
      });
    });
  }
  cancelWorkflow(id: string) {
    const workflow = this.store.get("workflows", id);
    if (!workflow) throw invalid("Workflow not found", 404);
    if (terminal.has(workflow.status)) return workflow;
    const tasks = this.store.list("tasks", { workflowId: id });
    const result = this.transaction(() => {
      for (const task of tasks) this.finish(task, "cancelled");
      return this.store.update("workflows", id, {
        status: "cancelled",
        completedAt: now(),
      });
    });
    for (const task of tasks)
      this.active
        .get(task.id)
        ?.controller.abort(new Error("Workflow cancelled"));
    return result;
  }
  private refreshWorkflow(id: string) {
    const tasks = this.store.list("tasks", { workflowId: id });
    if (tasks.length && tasks.every((x) => terminal.has(x.status)))
      this.store.update("workflows", id, {
        status: tasks.every((x) => x.status === "completed")
          ? "completed"
          : "failed",
        completedAt: now(),
        result: tasks.map((x) => ({
          taskId: x.id,
          result: x.result,
          error: x.error,
        })),
      });
  }
}
