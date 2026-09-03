import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_SETTINGS,
  clipTitle,
  newAgentId,
  newAutopilotRunId,
  newWorkItemEventId,
  newWorkItemId,
  normalizeIssueCode,
  type AgentProfile,
  type Autopilot,
  type AutopilotAction,
  type AutopilotConcurrencyPolicy,
  type AutopilotExecutionMode,
  type AutopilotRun,
  type AutopilotRunSource,
  type AutopilotRunStatus,
  type AutopilotStatus,
  type Settings,
  type Task,
  type TaskStatus,
  type WorkItem,
  type WorkItemEvent,
  type WorkItemEventKind,
  type WorkItemStatus,
} from "@agent-desk/core";

export interface DbPaths {
  dataDir: string;
  dbFile: string;
}

export function defaultDataDir(): string {
  const base = process.env.AD_DATA_DIR || path.join(os.homedir(), ".agent-desk");
  return path.resolve(base);
}

export function resolveDbPaths(dataDir = defaultDataDir()): DbPaths {
  return {
    dataDir,
    dbFile: path.join(dataDir, "agent-desk.db"),
  };
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    taskType: row.task_type as Task["taskType"],
    status: row.status as TaskStatus,
    skill: String(row.skill ?? ""),
    workflowId: String(row.workflow_id ?? ""),
    workflowRunId: String(row.workflow_run_id ?? ""),
    workflowName: String(row.workflow_name ?? ""),
    workflowMode: (row.workflow_mode as Task["workflowMode"]) ?? "",
    workflowStep: Number(row.workflow_step ?? 0),
    workflowStepTotal: Number(row.workflow_step_total ?? 0),
    parentTaskId: String(row.parent_task_id ?? ""),
    workflowNodeIndex:
      row.workflow_node_index === null || row.workflow_node_index === undefined
        ? null
        : Number(row.workflow_node_index),
    projectDir: String(row.project_dir ?? ""),
    workItemId: String(row.work_item_id ?? ""),
    issueCode: String(row.issue_code ?? ""),
    title: String(row.title ?? ""),
    prompt: String(row.prompt ?? ""),
    agentProfileId: String(row.agent_profile_id ?? ""),
    codingAgent: String(row.coding_agent ?? ""),
    model: String(row.model ?? ""),
    sessionId: String(row.session_id ?? ""),
    result: String(row.result ?? ""),
    gateNotifyHash: String(row.gate_notify_hash ?? ""),
    retryCount: Number(row.retry_count ?? 0),
    failureCode: (String(row.failure_code ?? "") || "") as Task["failureCode"],
    failureMessage: String(row.failure_message ?? ""),
    nextRetryAt: Number(row.next_retry_at ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastActivityAt: Number(row.last_activity_at),
  };
}

function rowToAgent(row: Record<string, unknown>): AgentProfile {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    provider: String(row.provider ?? ""),
    model: String(row.model ?? ""),
    defaultSkill: String(row.default_skill ?? "default") || "default",
    instructions: String(row.instructions ?? ""),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToAutopilot(row: Record<string, unknown>): Autopilot {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    runbook: String(row.runbook ?? ""),
    status: (String(row.status ?? "active") || "active") as AutopilotStatus,
    action: (String(row.action ?? "skill_task") || "skill_task") as AutopilotAction,
    executionMode: (String(row.execution_mode ?? "run_only") || "run_only") as AutopilotExecutionMode,
    skill: String(row.skill ?? ""),
    workflowId: String(row.workflow_id ?? ""),
    projectDir: String(row.project_dir ?? ""),
    agentProfileId: String(row.agent_profile_id ?? ""),
    model: String(row.model ?? ""),
    titleTemplate: String(row.title_template ?? ""),
    cronExpression: String(row.cron_expression ?? ""),
    timezone: String(row.timezone ?? "local"),
    nextRunAt: Number(row.next_run_at ?? 0),
    lastRunAt: Number(row.last_run_at ?? 0),
    concurrencyPolicy: (String(row.concurrency_policy ?? "skip") ||
      "skip") as AutopilotConcurrencyPolicy,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToAutopilotRun(row: Record<string, unknown>): AutopilotRun {
  return {
    id: String(row.id),
    autopilotId: String(row.autopilot_id ?? ""),
    source: (String(row.source ?? "schedule") || "schedule") as AutopilotRunSource,
    status: (String(row.status ?? "pending") || "pending") as AutopilotRunStatus,
    taskId: String(row.task_id ?? ""),
    workflowRunId: String(row.workflow_run_id ?? ""),
    workItemId: String(row.work_item_id ?? ""),
    plannedAt: Number(row.planned_at ?? 0),
    triggeredAt: Number(row.triggered_at ?? 0),
    completedAt: Number(row.completed_at ?? 0),
    failureReason: String(row.failure_reason ?? ""),
    createdAt: Number(row.created_at ?? 0),
  };
}

function rowToWorkItem(row: Record<string, unknown>): WorkItem {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    status: (String(row.status ?? "open") || "open") as WorkItemStatus,
    projectDir: String(row.project_dir ?? ""),
    issueProvider: String(row.issue_provider ?? ""),
    issueCode: String(row.issue_code ?? ""),
    agentProfileId: String(row.agent_profile_id ?? ""),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastActivityAt: Number(row.last_activity_at),
  };
}

function rowToWorkItemEvent(row: Record<string, unknown>): WorkItemEvent {
  return {
    id: String(row.id),
    workItemId: String(row.work_item_id ?? ""),
    kind: (String(row.kind ?? "note") || "note") as WorkItemEventKind,
    author: String(row.author ?? "user"),
    body: String(row.body ?? ""),
    taskId: String(row.task_id ?? ""),
    createdAt: Number(row.created_at),
  };
}

export interface ResolveWorkItemInput {
  workItemId?: string;
  issueCode?: string;
  issueProvider?: string;
  title?: string;
  description?: string;
  projectDir?: string;
  agentProfileId?: string;
}

const ACTIVE_TASK_STATUSES = new Set(["created", "queued", "running", "awaiting"]);

const AGENT_PRESETS: Record<string, { name: string; defaultSkill: string }> = {
  claude: { name: "Claude", defaultSkill: "default" },
  codex: { name: "Codex", defaultSkill: "default" },
  cursor: { name: "Cursor", defaultSkill: "default" },
};

export class AgentDeskDb {
  readonly db: Database.Database;

  constructor(paths: DbPaths) {
    fs.mkdirSync(paths.dataDir, { recursive: true });
    this.db = new Database(paths.dbFile);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        skill TEXT,
        workflow_id TEXT,
        workflow_run_id TEXT,
        workflow_name TEXT,
        workflow_mode TEXT,
        workflow_step INTEGER DEFAULT 0,
        workflow_step_total INTEGER DEFAULT 0,
        parent_task_id TEXT,
        workflow_node_index INTEGER,
        project_dir TEXT,
        issue_code TEXT,
        title TEXT,
        prompt TEXT,
        coding_agent TEXT,
        session_id TEXT,
        result TEXT,
        gate_notify_hash TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        default_skill TEXT NOT NULL DEFAULT 'default',
        instructions TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at DESC);
    `);
    this.ensureTaskColumn("model", "TEXT");
    this.ensureTaskColumn("agent_profile_id", "TEXT");
    this.ensureTaskColumn("retry_count", "INTEGER DEFAULT 0");
    this.ensureTaskColumn("failure_code", "TEXT DEFAULT ''");
    this.ensureTaskColumn("failure_message", "TEXT DEFAULT ''");
    this.ensureTaskColumn("next_retry_at", "INTEGER DEFAULT 0");
    this.ensureTaskColumn("work_item_id", "TEXT");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        project_dir TEXT NOT NULL DEFAULT '',
        issue_provider TEXT NOT NULL DEFAULT '',
        issue_code TEXT NOT NULL DEFAULT '',
        issue_code_norm TEXT NOT NULL DEFAULT '',
        agent_profile_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_work_items_issue ON work_items(issue_provider, issue_code_norm);
      CREATE INDEX IF NOT EXISTS idx_work_items_updated ON work_items(updated_at DESC);

      CREATE TABLE IF NOT EXISTS work_item_events (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT 'user',
        body TEXT NOT NULL DEFAULT '',
        task_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_work_item_events_wi ON work_item_events(work_item_id, created_at DESC);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS autopilots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        runbook TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        action TEXT NOT NULL,
        execution_mode TEXT NOT NULL DEFAULT 'run_only',
        skill TEXT NOT NULL DEFAULT '',
        workflow_id TEXT NOT NULL DEFAULT '',
        project_dir TEXT NOT NULL DEFAULT '',
        agent_profile_id TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        title_template TEXT NOT NULL DEFAULT '',
        cron_expression TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'local',
        next_run_at INTEGER NOT NULL DEFAULT 0,
        last_run_at INTEGER NOT NULL DEFAULT 0,
        concurrency_policy TEXT NOT NULL DEFAULT 'skip',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_autopilots_next ON autopilots(status, next_run_at);

      CREATE TABLE IF NOT EXISTS autopilot_runs (
        id TEXT PRIMARY KEY,
        autopilot_id TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        task_id TEXT NOT NULL DEFAULT '',
        workflow_run_id TEXT NOT NULL DEFAULT '',
        work_item_id TEXT NOT NULL DEFAULT '',
        planned_at INTEGER NOT NULL DEFAULT 0,
        triggered_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL DEFAULT 0,
        failure_reason TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_autopilot_runs_ap ON autopilot_runs(autopilot_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_runs_plan
        ON autopilot_runs(autopilot_id, planned_at)
        WHERE planned_at > 0;
    `);
    this.backfillWorkItemsFromTasks();
    this.ensureDefaultAgents();
  }

  private ensureDefaultAgents(): void {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number };
    if ((row?.n ?? 0) > 0) return;

    const settings = this.getSettings();
    const now = Date.now();
    let defaultAgentId = "";
    for (const [provider, preset] of Object.entries(AGENT_PRESETS)) {
      const agent: AgentProfile = {
        id: newAgentId(),
        name: preset.name,
        provider,
        model: "",
        defaultSkill: preset.defaultSkill,
        instructions: "",
        createdAt: now,
        updatedAt: now,
      };
      this.upsertAgent(agent);
      if (settings.codingAgent === provider && !defaultAgentId) {
        defaultAgentId = agent.id;
      }
    }
    if (!defaultAgentId) {
      const first = this.listAgents()[0];
      defaultAgentId = first?.id ?? "";
    }
    if (defaultAgentId && !settings.defaultAgentId) {
      const first = this.getAgent(defaultAgentId);
      this.saveSettings({
        ...settings,
        defaultAgentId,
        codingAgent: first?.provider || settings.codingAgent,
      });
    }
  }

  private ensureTaskColumn(name: string, ddl: string): void {
    const cols = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === name)) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${ddl}`);
    }
  }

  getSettings(): Settings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get("main") as
      | { value: string }
      | undefined;
    if (!row) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(row.value) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      providers: {
        ...DEFAULT_SETTINGS.providers,
        ...(parsed.providers || {}),
      },
      dingtalk: {
        ...DEFAULT_SETTINGS.dingtalk,
        ...(parsed.dingtalk || {}),
      },
      github: {
        ...DEFAULT_SETTINGS.github,
        ...(parsed.github || {}),
      },
      gitlab: {
        ...DEFAULT_SETTINGS.gitlab,
        ...(parsed.gitlab || {}),
      },
      notifyWebhook: {
        ...DEFAULT_SETTINGS.notifyWebhook,
        ...(parsed.notifyWebhook || {}),
      },
    };
  }

  listAgents(): AgentProfile[] {
    const rows = this.db
      .prepare("SELECT * FROM agents ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(rowToAgent);
  }

  getAgent(id: string): AgentProfile | null {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToAgent(row) : null;
  }

  upsertAgent(agent: AgentProfile): void {
    this.db
      .prepare(
        `INSERT INTO agents (
          id, name, provider, model, default_skill, instructions, created_at, updated_at
        ) VALUES (
          @id, @name, @provider, @model, @defaultSkill, @instructions, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, provider=excluded.provider, model=excluded.model,
          default_skill=excluded.default_skill, instructions=excluded.instructions,
          updated_at=excluded.updated_at`,
      )
      .run({
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        defaultSkill: agent.defaultSkill,
        instructions: agent.instructions,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      });
  }

  deleteAgent(id: string): boolean {
    const r = this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    return r.changes > 0;
  }

  saveSettings(settings: Settings): void {
    this.db
      .prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("main", JSON.stringify(settings));
  }

  listTasks(limit = 100): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToTask);
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToTask(row) : null;
  }

  upsertTask(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (
          id, task_type, status, skill, workflow_id, workflow_run_id, workflow_name,
          workflow_mode, workflow_step, workflow_step_total, parent_task_id,
          workflow_node_index, project_dir, work_item_id, issue_code, title, prompt, agent_profile_id, coding_agent, model,
          session_id, result, gate_notify_hash, retry_count, failure_code, failure_message, next_retry_at,
          created_at, updated_at, last_activity_at
        ) VALUES (
          @id, @taskType, @status, @skill, @workflowId, @workflowRunId, @workflowName,
          @workflowMode, @workflowStep, @workflowStepTotal, @parentTaskId,
          @workflowNodeIndex, @projectDir, @workItemId, @issueCode, @title, @prompt, @agentProfileId, @codingAgent, @model,
          @sessionId, @result, @gateNotifyHash, @retryCount, @failureCode, @failureMessage, @nextRetryAt,
          @createdAt, @updatedAt, @lastActivityAt
        )
        ON CONFLICT(id) DO UPDATE SET
          task_type=excluded.task_type, status=excluded.status, skill=excluded.skill,
          workflow_id=excluded.workflow_id, workflow_run_id=excluded.workflow_run_id,
          workflow_name=excluded.workflow_name, workflow_mode=excluded.workflow_mode,
          workflow_step=excluded.workflow_step, workflow_step_total=excluded.workflow_step_total,
          parent_task_id=excluded.parent_task_id, workflow_node_index=excluded.workflow_node_index,
          project_dir=excluded.project_dir, work_item_id=excluded.work_item_id, issue_code=excluded.issue_code, title=excluded.title,
          prompt=excluded.prompt, agent_profile_id=excluded.agent_profile_id, coding_agent=excluded.coding_agent, model=excluded.model,
          session_id=excluded.session_id, result=excluded.result, gate_notify_hash=excluded.gate_notify_hash,
          retry_count=excluded.retry_count, failure_code=excluded.failure_code,
          failure_message=excluded.failure_message, next_retry_at=excluded.next_retry_at,
          updated_at=excluded.updated_at, last_activity_at=excluded.last_activity_at`,
      )
      .run({
        id: task.id,
        taskType: task.taskType,
        status: task.status,
        skill: task.skill,
        workflowId: task.workflowId,
        workflowRunId: task.workflowRunId,
        workflowName: task.workflowName,
        workflowMode: task.workflowMode,
        workflowStep: task.workflowStep,
        workflowStepTotal: task.workflowStepTotal,
        parentTaskId: task.parentTaskId,
        workflowNodeIndex: task.workflowNodeIndex,
        projectDir: task.projectDir,
        workItemId: task.workItemId,
        issueCode: task.issueCode,
        title: task.title,
        prompt: task.prompt,
        agentProfileId: task.agentProfileId,
        codingAgent: task.codingAgent,
        model: task.model,
        sessionId: task.sessionId,
        result: task.result,
        gateNotifyHash: task.gateNotifyHash,
        retryCount: task.retryCount,
        failureCode: task.failureCode,
        failureMessage: task.failureMessage,
        nextRetryAt: task.nextRetryAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        lastActivityAt: task.lastActivityAt,
      });
    if (task.workItemId) this.syncWorkItemStatus(task.workItemId);
  }

  updateTask(id: string, patch: Partial<Task>): Task | null {
    const current = this.getTask(id);
    if (!current) return null;
    const now = Date.now();
    const next: Task = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: now,
      lastActivityAt: patch.lastActivityAt ?? now,
    };
    this.upsertTask(next);
    if (next.workItemId) this.syncWorkItemStatus(next.workItemId);
    return next;
  }

  deleteTask(id: string): boolean {
    const r = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return r.changes > 0;
  }

  listWorkItems(limit = 100): WorkItem[] {
    const rows = this.db
      .prepare("SELECT * FROM work_items ORDER BY last_activity_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToWorkItem);
  }

  getWorkItem(id: string): WorkItem | null {
    const row = this.db.prepare("SELECT * FROM work_items WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToWorkItem(row) : null;
  }

  findWorkItemByIssue(issueProvider: string, issueCode: string): WorkItem | null {
    const norm = normalizeIssueCode(issueCode);
    if (!norm) return null;
    const row = this.db
      .prepare(
        `SELECT * FROM work_items
         WHERE issue_provider = @issueProvider AND issue_code_norm = @norm
         LIMIT 1`,
      )
      .get({ issueProvider: issueProvider || "", norm }) as Record<string, unknown> | undefined;
    return row ? rowToWorkItem(row) : null;
  }

  listTasksForWorkItem(workItemId: string, limit = 200): Task[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks WHERE work_item_id = @workItemId
         ORDER BY created_at DESC LIMIT @limit`,
      )
      .all({ workItemId, limit }) as Record<string, unknown>[];
    return rows.map(rowToTask);
  }

  upsertWorkItem(item: WorkItem): void {
    const norm = normalizeIssueCode(item.issueCode);
    this.db
      .prepare(
        `INSERT INTO work_items (
          id, title, description, status, project_dir, issue_provider, issue_code,
          issue_code_norm, agent_profile_id, created_at, updated_at, last_activity_at
        ) VALUES (
          @id, @title, @description, @status, @projectDir, @issueProvider, @issueCode,
          @issueCodeNorm, @agentProfileId, @createdAt, @updatedAt, @lastActivityAt
        )
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, description=excluded.description, status=excluded.status,
          project_dir=excluded.project_dir, issue_provider=excluded.issue_provider,
          issue_code=excluded.issue_code, issue_code_norm=excluded.issue_code_norm,
          agent_profile_id=excluded.agent_profile_id,
          updated_at=excluded.updated_at, last_activity_at=excluded.last_activity_at`,
      )
      .run({
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.status,
        projectDir: item.projectDir,
        issueProvider: item.issueProvider,
        issueCode: item.issueCode,
        issueCodeNorm: norm,
        agentProfileId: item.agentProfileId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        lastActivityAt: item.lastActivityAt,
      });
  }

  touchWorkItem(workItemId: string, patch?: Partial<Pick<WorkItem, "status" | "title" | "projectDir">>): void {
    const current = this.getWorkItem(workItemId);
    if (!current) return;
    const now = Date.now();
    this.upsertWorkItem({
      ...current,
      ...patch,
      updatedAt: now,
      lastActivityAt: now,
    });
  }

  resolveOrCreateWorkItem(input: ResolveWorkItemInput, settings: Settings): WorkItem | null {
    const workItemId = (input.workItemId || "").trim();
    if (workItemId) return this.getWorkItem(workItemId);

    const issueCode = String(input.issueCode || "").trim();
    const norm = normalizeIssueCode(issueCode);
    if (!norm) return null;

    const issueProvider = (input.issueProvider || settings.providers.issue || "").trim();
    const existing = this.findWorkItemByIssue(issueProvider, issueCode);
    if (existing) return existing;

    const now = Date.now();
    const displayCode = issueCode.startsWith("#") ? issueCode : `#${norm}`;
    const item: WorkItem = {
      id: newWorkItemId(),
      title: clipTitle(input.title || displayCode, displayCode, 200),
      description: String(input.description || "").trim(),
      status: "open",
      projectDir: path.resolve(input.projectDir || process.cwd()),
      issueProvider,
      issueCode: displayCode,
      agentProfileId: String(input.agentProfileId || "").trim(),
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };
    this.upsertWorkItem(item);
    return item;
  }

  syncWorkItemStatus(workItemId: string): void {
    const id = (workItemId || "").trim();
    if (!id) return;
    const current = this.getWorkItem(id);
    if (!current) return;
    // Human-cancelled stays cancelled until explicitly reopened.
    if (current.status === "cancelled") return;

    const tasks = this.listTasksForWorkItem(id, 500);
    let status: WorkItemStatus = "open";
    if (tasks.some((t) => ACTIVE_TASK_STATUSES.has(t.status))) {
      status = "in_progress";
    } else if (tasks.some((t) => t.status === "done")) {
      // Delivery complete → wait for human acceptance (do not auto-close).
      // Preserve done only after explicit accept; migrate legacy auto-done → in_review.
      const accepted = this.listWorkItemEvents(id, 100).some(
        (e) =>
          e.kind === "system" &&
          e.author === "user" &&
          String(e.body || "").includes("验收通过"),
      );
      status = accepted ? "done" : "in_review";
    } else if (tasks.length) {
      status = "open";
    }

    const lastActivityAt = tasks.reduce(
      (max, t) => Math.max(max, Number(t.lastActivityAt || t.updatedAt || 0)),
      current.lastActivityAt,
    );
    if (status !== current.status || lastActivityAt !== current.lastActivityAt) {
      this.upsertWorkItem({
        ...current,
        status,
        lastActivityAt,
        updatedAt: Date.now(),
      });
    }
  }

  listWorkItemsByStatus(status: WorkItemStatus, limit = 100): WorkItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM work_items WHERE status = @status
         ORDER BY last_activity_at DESC LIMIT @limit`,
      )
      .all({ status, limit }) as Record<string, unknown>[];
    return rows.map(rowToWorkItem);
  }

  acceptWorkItem(workItemId: string): WorkItem | null {
    const current = this.getWorkItem(workItemId);
    if (!current) return null;
    if (current.status !== "in_review") return null;
    const now = Date.now();
    const next: WorkItem = {
      ...current,
      status: "done",
      updatedAt: now,
      lastActivityAt: now,
    };
    this.upsertWorkItem(next);
    this.addWorkItemEvent({
      workItemId: next.id,
      kind: "system",
      author: "user",
      body: "验收通过",
    });
    return next;
  }

  rejectWorkItem(workItemId: string, note?: string): WorkItem | null {
    const current = this.getWorkItem(workItemId);
    if (!current) return null;
    if (current.status !== "in_review") return null;
    const now = Date.now();
    const next: WorkItem = {
      ...current,
      status: "open",
      updatedAt: now,
      lastActivityAt: now,
    };
    this.upsertWorkItem(next);
    const text = String(note || "").trim();
    this.addWorkItemEvent({
      workItemId: next.id,
      kind: "system",
      author: "user",
      body: text ? `验收未通过：${text}` : "验收未通过，已重新打开",
    });
    return next;
  }

  listWorkItemEvents(workItemId: string, limit = 200): WorkItemEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM work_item_events WHERE work_item_id = @workItemId
         ORDER BY created_at ASC LIMIT @limit`,
      )
      .all({ workItemId, limit }) as Record<string, unknown>[];
    return rows.map(rowToWorkItemEvent);
  }

  addWorkItemEvent(input: {
    workItemId: string;
    kind: WorkItemEventKind;
    body: string;
    author?: string;
    taskId?: string;
    createdAt?: number;
  }): WorkItemEvent | null {
    const workItemId = (input.workItemId || "").trim();
    if (!workItemId || !this.getWorkItem(workItemId)) return null;
    const body = String(input.body || "").trim();
    if (!body) return null;
    const now = input.createdAt ?? Date.now();
    const event: WorkItemEvent = {
      id: newWorkItemEventId(),
      workItemId,
      kind: input.kind,
      author: (input.author || "user").trim() || "user",
      body,
      taskId: String(input.taskId || "").trim(),
      createdAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO work_item_events (
          id, work_item_id, kind, author, body, task_id, created_at
        ) VALUES (
          @id, @workItemId, @kind, @author, @body, @taskId, @createdAt
        )`,
      )
      .run({
        id: event.id,
        workItemId: event.workItemId,
        kind: event.kind,
        author: event.author,
        body: event.body,
        taskId: event.taskId,
        createdAt: event.createdAt,
      });
    this.touchWorkItem(workItemId);
    return event;
  }

  private backfillWorkItemsFromTasks(): void {
    const flag = this.db.prepare("SELECT value FROM settings WHERE key = ?").get("work_items_backfill_v1") as
      | { value: string }
      | undefined;
    if (flag?.value === "1") return;

    const settings = this.getSettings();
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE TRIM(COALESCE(issue_code, '')) != ''
         ORDER BY created_at ASC`,
      )
      .all() as Record<string, unknown>[];

    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const provider = settings.providers.issue || "";
      const norm = normalizeIssueCode(String(row.issue_code ?? ""));
      if (!norm) continue;
      const key = `${provider}\0${norm}`;
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    }

    for (const [, taskRows] of groups) {
      const first = taskRows[0];
      const issueCode = String(first.issue_code ?? "");
      const norm = normalizeIssueCode(issueCode);
      const provider = settings.providers.issue || "";
      let workItem = this.findWorkItemByIssue(provider, issueCode);
      if (!workItem) {
        const latest = taskRows[taskRows.length - 1];
        const now = Date.now();
        workItem = {
          id: newWorkItemId(),
          title: clipTitle(String(latest.title ?? issueCode), issueCode, 200),
          description: "",
          status: "open",
          projectDir: String(latest.project_dir ?? ""),
          issueProvider: provider,
          issueCode: issueCode.startsWith("#") ? issueCode : `#${norm}`,
          agentProfileId: String(latest.agent_profile_id ?? ""),
          createdAt: Number(first.created_at ?? now),
          updatedAt: now,
          lastActivityAt: Number(latest.last_activity_at ?? latest.updated_at ?? now),
        };
        this.upsertWorkItem(workItem);
      }
      for (const row of taskRows) {
        const taskId = String(row.id);
        const existingWi = String(row.work_item_id ?? "").trim();
        if (!existingWi) {
          this.db.prepare("UPDATE tasks SET work_item_id = ? WHERE id = ?").run(workItem.id, taskId);
        }
      }
      this.syncWorkItemStatus(workItem.id);
    }

    this.db
      .prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("work_items_backfill_v1", "1");
  }

  /** Tasks still using a workspace (created / running / awaiting). */
  countActiveTasksForProjectDir(projectDir: string, exceptId?: string): number {
    const resolved = path.resolve(projectDir);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
         WHERE project_dir = @projectDir
           AND status IN ('created', 'running', 'awaiting')
           AND (@exceptId = '' OR id != @exceptId)`,
      )
      .get({ projectDir: resolved, exceptId: exceptId ?? "" }) as { n: number };
    return row?.n ?? 0;
  }

  listAutopilots(limit = 200): Autopilot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM autopilots
         WHERE status != 'archived'
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToAutopilot);
  }

  getAutopilot(id: string): Autopilot | null {
    const row = this.db.prepare("SELECT * FROM autopilots WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToAutopilot(row) : null;
  }

  upsertAutopilot(item: Autopilot): void {
    this.db
      .prepare(
        `INSERT INTO autopilots (
          id, name, runbook, status, action, execution_mode, skill, workflow_id,
          project_dir, agent_profile_id, model, title_template, cron_expression,
          timezone, next_run_at, last_run_at, concurrency_policy, created_at, updated_at
        ) VALUES (
          @id, @name, @runbook, @status, @action, @executionMode, @skill, @workflowId,
          @projectDir, @agentProfileId, @model, @titleTemplate, @cronExpression,
          @timezone, @nextRunAt, @lastRunAt, @concurrencyPolicy, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, runbook=excluded.runbook, status=excluded.status,
          action=excluded.action, execution_mode=excluded.execution_mode,
          skill=excluded.skill, workflow_id=excluded.workflow_id,
          project_dir=excluded.project_dir, agent_profile_id=excluded.agent_profile_id,
          model=excluded.model, title_template=excluded.title_template,
          cron_expression=excluded.cron_expression, timezone=excluded.timezone,
          next_run_at=excluded.next_run_at, last_run_at=excluded.last_run_at,
          concurrency_policy=excluded.concurrency_policy, updated_at=excluded.updated_at`,
      )
      .run({
        id: item.id,
        name: item.name,
        runbook: item.runbook,
        status: item.status,
        action: item.action,
        executionMode: item.executionMode,
        skill: item.skill,
        workflowId: item.workflowId,
        projectDir: item.projectDir,
        agentProfileId: item.agentProfileId,
        model: item.model,
        titleTemplate: item.titleTemplate,
        cronExpression: item.cronExpression,
        timezone: item.timezone,
        nextRunAt: item.nextRunAt,
        lastRunAt: item.lastRunAt,
        concurrencyPolicy: item.concurrencyPolicy,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
  }

  deleteAutopilot(id: string): boolean {
    const current = this.getAutopilot(id);
    if (!current) return false;
    this.upsertAutopilot({
      ...current,
      status: "archived",
      updatedAt: Date.now(),
      nextRunAt: 0,
    });
    return true;
  }

  listDueAutopilots(nowMs = Date.now(), limit = 50): Autopilot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM autopilots
         WHERE status = 'active' AND next_run_at > 0 AND next_run_at <= @now
         ORDER BY next_run_at ASC LIMIT @limit`,
      )
      .all({ now: nowMs, limit }) as Record<string, unknown>[];
    return rows.map(rowToAutopilot);
  }

  listAutopilotRuns(autopilotId: string, limit = 50): AutopilotRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM autopilot_runs WHERE autopilot_id = @autopilotId
         ORDER BY created_at DESC LIMIT @limit`,
      )
      .all({ autopilotId, limit }) as Record<string, unknown>[];
    return rows.map(rowToAutopilotRun);
  }

  getAutopilotRun(id: string): AutopilotRun | null {
    const row = this.db.prepare("SELECT * FROM autopilot_runs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToAutopilotRun(row) : null;
  }

  upsertAutopilotRun(run: AutopilotRun): void {
    this.db
      .prepare(
        `INSERT INTO autopilot_runs (
          id, autopilot_id, source, status, task_id, workflow_run_id, work_item_id,
          planned_at, triggered_at, completed_at, failure_reason, created_at
        ) VALUES (
          @id, @autopilotId, @source, @status, @taskId, @workflowRunId, @workItemId,
          @plannedAt, @triggeredAt, @completedAt, @failureReason, @createdAt
        )
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status, task_id=excluded.task_id,
          workflow_run_id=excluded.workflow_run_id, work_item_id=excluded.work_item_id,
          completed_at=excluded.completed_at, failure_reason=excluded.failure_reason`,
      )
      .run({
        id: run.id,
        autopilotId: run.autopilotId,
        source: run.source,
        status: run.status,
        taskId: run.taskId,
        workflowRunId: run.workflowRunId,
        workItemId: run.workItemId,
        plannedAt: run.plannedAt,
        triggeredAt: run.triggeredAt,
        completedAt: run.completedAt,
        failureReason: run.failureReason,
        createdAt: run.createdAt,
      });
  }

  findAutopilotRunByPlan(autopilotId: string, plannedAt: number): AutopilotRun | null {
    if (!plannedAt) return null;
    const row = this.db
      .prepare(
        `SELECT * FROM autopilot_runs
         WHERE autopilot_id = @autopilotId AND planned_at = @plannedAt
         LIMIT 1`,
      )
      .get({ autopilotId, plannedAt }) as Record<string, unknown> | undefined;
    return row ? rowToAutopilotRun(row) : null;
  }

  hasActiveAutopilotRun(autopilotId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM autopilot_runs
         WHERE autopilot_id = @autopilotId AND status IN ('pending', 'running')`,
      )
      .get({ autopilotId }) as { n: number };
    return (row?.n ?? 0) > 0;
  }

  createAutopilotRunStub(input: {
    autopilotId: string;
    source: AutopilotRunSource;
    plannedAt?: number;
  }): AutopilotRun | null {
    const plannedAt = Number(input.plannedAt || 0);
    if (plannedAt > 0 && this.findAutopilotRunByPlan(input.autopilotId, plannedAt)) {
      return null;
    }
    const now = Date.now();
    const run: AutopilotRun = {
      id: newAutopilotRunId(),
      autopilotId: input.autopilotId,
      source: input.source,
      status: "pending",
      taskId: "",
      workflowRunId: "",
      workItemId: "",
      plannedAt,
      triggeredAt: now,
      completedAt: 0,
      failureReason: "",
      createdAt: now,
    };
    try {
      this.upsertAutopilotRun(run);
      return run;
    } catch {
      return null;
    }
  }
}

export function openDb(dataDir?: string): AgentDeskDb {
  return new AgentDeskDb(resolveDbPaths(dataDir));
}
