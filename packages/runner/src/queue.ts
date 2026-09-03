import path from "node:path";
import type { Settings, Task, TaskFailureCode } from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";

export interface QueueRunnerOptions {
  db: AgentDeskDb;
  settings: Settings;
  dataDir?: string;
}

type StartTaskFn = (opts: QueueRunnerOptions, taskId: string) => Promise<Task>;

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function resolveProjectDir(task: Task): string {
  return path.resolve(task.projectDir || process.cwd());
}

export function clearRetryTimer(taskId: string): void {
  const timer = retryTimers.get(taskId);
  if (timer) clearTimeout(timer);
  retryTimers.delete(taskId);
}

export function scheduleDelayedStart(
  opts: QueueRunnerOptions,
  taskId: string,
  delayMs: number,
  startTask: StartTaskFn,
): void {
  clearRetryTimer(taskId);
  const wait = Math.max(0, delayMs);
  const timer = setTimeout(() => {
    retryTimers.delete(taskId);
    void startTask(opts, taskId).catch((err) => {
      console.error(`[agent-desk] delayed start ${taskId}:`, err);
    });
  }, wait);
  retryTimers.set(taskId, timer);
}

export function listQueuedForDir(db: AgentDeskDb, projectDir: string): Task[] {
  const resolved = path.resolve(projectDir || process.cwd());
  return db
    .listTasks(500)
    .filter((t) => t.status === "queued" && resolveProjectDir(t) === resolved)
    .sort((a, b) => {
      const aAt = a.nextRetryAt > 0 ? a.nextRetryAt : a.createdAt;
      const bAt = b.nextRetryAt > 0 ? b.nextRetryAt : b.createdAt;
      return aAt - bAt || a.createdAt - b.createdAt;
    });
}

export async function processWorkspaceQueue(
  opts: QueueRunnerOptions,
  projectDir: string,
  startTask: StartTaskFn,
): Promise<void> {
  const dir = path.resolve(projectDir || process.cwd());
  if (opts.db.countActiveTasksForProjectDir(dir)) return;

  const queued = listQueuedForDir(opts.db, dir);
  if (!queued.length) return;

  const now = Date.now();
  const ready = queued.find((t) => !t.nextRetryAt || t.nextRetryAt <= now);
  if (!ready) {
    const next = queued.find((t) => t.nextRetryAt > now);
    if (next) scheduleDelayedStart(opts, next.id, next.nextRetryAt - now, startTask);
    return;
  }

  await startTask(opts, ready.id);
}

export function retryPolicy(settings: Settings): { enabled: boolean; max: number; delaySec: number } {
  return {
    enabled: settings.autoRetryEnabled !== false,
    max: Math.max(0, Number(settings.maxRetries ?? 2)),
    delaySec: Math.max(5, Number(settings.retryDelaySec ?? 30)),
  };
}

/** Failures that won't clear by waiting (missing CLI / backend). */
export function isNonRetryableFailure(code: TaskFailureCode | string | undefined): boolean {
  return code === "spawn_error" || code === "backend_unavailable";
}

export async function maybeScheduleAutoRetry(
  opts: QueueRunnerOptions,
  task: Task,
  startTask: StartTaskFn,
): Promise<Task> {
  const settings = opts.db.getSettings();
  const policy = retryPolicy(settings);
  if (!policy.enabled || task.retryCount >= policy.max || isNonRetryableFailure(task.failureCode)) {
    await processWorkspaceQueue(opts, task.projectDir, startTask);
    return task;
  }

  const nextRetryAt = Date.now() + policy.delaySec * 1000;
  const attempt = task.retryCount + 1;
  const baseMsg = task.failureMessage || "任务失败";
  const message = `${baseMsg} · 将于 ${policy.delaySec}s 后重试 (${attempt}/${policy.max})`;
  const updated =
    opts.db.updateTask(task.id, {
      status: "queued",
      retryCount: attempt,
      nextRetryAt,
      failureMessage: message,
    }) ?? task;

  scheduleDelayedStart(opts, updated.id, policy.delaySec * 1000, startTask);
  await processWorkspaceQueue(opts, updated.projectDir, startTask);
  return updated;
}

export function bootstrapTaskQueue(opts: QueueRunnerOptions, startTask: StartTaskFn): void {
  const now = Date.now();
  for (const task of opts.db.listTasks(500)) {
    if (task.status !== "queued") continue;
    const delay = task.nextRetryAt > now ? task.nextRetryAt - now : 0;
    scheduleDelayedStart(opts, task.id, delay, startTask);
  }
  const dirs = new Set<string>();
  for (const task of opts.db.listTasks(500)) {
    if (task.status === "queued" && (!task.nextRetryAt || task.nextRetryAt <= now)) {
      dirs.add(resolveProjectDir(task));
    }
  }
  for (const dir of dirs) {
    void processWorkspaceQueue(opts, dir, startTask);
  }
}

export function failureCodeFromError(err: unknown): TaskFailureCode {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/not found|ENOENT|command not found|spawn/i.test(msg)) return "spawn_error";
  if (/not installed|requireReady|backend/i.test(msg)) return "backend_unavailable";
  return "start_error";
}
