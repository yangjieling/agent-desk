import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_SETTINGS,
  newAgentId,
  type AgentProfile,
  type Settings,
  type Task,
  type TaskStatus,
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
    issueCode: String(row.issue_code ?? ""),
    title: String(row.title ?? ""),
    prompt: String(row.prompt ?? ""),
    agentProfileId: String(row.agent_profile_id ?? ""),
    codingAgent: String(row.coding_agent ?? ""),
    model: String(row.model ?? ""),
    sessionId: String(row.session_id ?? ""),
    result: String(row.result ?? ""),
    gateNotifyHash: String(row.gate_notify_hash ?? ""),
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
          workflow_node_index, project_dir, issue_code, title, prompt, agent_profile_id, coding_agent, model,
          session_id, result, gate_notify_hash, created_at, updated_at, last_activity_at
        ) VALUES (
          @id, @taskType, @status, @skill, @workflowId, @workflowRunId, @workflowName,
          @workflowMode, @workflowStep, @workflowStepTotal, @parentTaskId,
          @workflowNodeIndex, @projectDir, @issueCode, @title, @prompt, @agentProfileId, @codingAgent, @model,
          @sessionId, @result, @gateNotifyHash, @createdAt, @updatedAt, @lastActivityAt
        )
        ON CONFLICT(id) DO UPDATE SET
          task_type=excluded.task_type, status=excluded.status, skill=excluded.skill,
          workflow_id=excluded.workflow_id, workflow_run_id=excluded.workflow_run_id,
          workflow_name=excluded.workflow_name, workflow_mode=excluded.workflow_mode,
          workflow_step=excluded.workflow_step, workflow_step_total=excluded.workflow_step_total,
          parent_task_id=excluded.parent_task_id, workflow_node_index=excluded.workflow_node_index,
          project_dir=excluded.project_dir, issue_code=excluded.issue_code, title=excluded.title,
          prompt=excluded.prompt, agent_profile_id=excluded.agent_profile_id, coding_agent=excluded.coding_agent, model=excluded.model,
          session_id=excluded.session_id, result=excluded.result, gate_notify_hash=excluded.gate_notify_hash,
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
        issueCode: task.issueCode,
        title: task.title,
        prompt: task.prompt,
        agentProfileId: task.agentProfileId,
        codingAgent: task.codingAgent,
        model: task.model,
        sessionId: task.sessionId,
        result: task.result,
        gateNotifyHash: task.gateNotifyHash,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        lastActivityAt: task.lastActivityAt,
      });
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
    return next;
  }

  deleteTask(id: string): boolean {
    const r = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return r.changes > 0;
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
}

export function openDb(dataDir?: string): AgentDeskDb {
  return new AgentDeskDb(resolveDbPaths(dataDir));
}
