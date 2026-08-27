import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_SETTINGS,
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
    codingAgent: String(row.coding_agent ?? ""),
    sessionId: String(row.session_id ?? ""),
    result: String(row.result ?? ""),
    gateNotifyHash: String(row.gate_notify_hash ?? ""),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastActivityAt: Number(row.last_activity_at),
  };
}

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
    `);
  }

  getSettings(): Settings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get("main") as
      | { value: string }
      | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
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
          workflow_node_index, project_dir, issue_code, title, prompt, coding_agent,
          session_id, result, gate_notify_hash, created_at, updated_at, last_activity_at
        ) VALUES (
          @id, @taskType, @status, @skill, @workflowId, @workflowRunId, @workflowName,
          @workflowMode, @workflowStep, @workflowStepTotal, @parentTaskId,
          @workflowNodeIndex, @projectDir, @issueCode, @title, @prompt, @codingAgent,
          @sessionId, @result, @gateNotifyHash, @createdAt, @updatedAt, @lastActivityAt
        )
        ON CONFLICT(id) DO UPDATE SET
          task_type=excluded.task_type, status=excluded.status, skill=excluded.skill,
          workflow_id=excluded.workflow_id, workflow_run_id=excluded.workflow_run_id,
          workflow_name=excluded.workflow_name, workflow_mode=excluded.workflow_mode,
          workflow_step=excluded.workflow_step, workflow_step_total=excluded.workflow_step_total,
          parent_task_id=excluded.parent_task_id, workflow_node_index=excluded.workflow_node_index,
          project_dir=excluded.project_dir, issue_code=excluded.issue_code, title=excluded.title,
          prompt=excluded.prompt, coding_agent=excluded.coding_agent, session_id=excluded.session_id,
          result=excluded.result, gate_notify_hash=excluded.gate_notify_hash,
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
        codingAgent: task.codingAgent,
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
}

export function openDb(dataDir?: string): AgentDeskDb {
  return new AgentDeskDb(resolveDbPaths(dataDir));
}
