import path from "node:path";
import type { Settings, Task, TaskFailureCode } from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import { publishTaskUpdate } from "./task-events.js";

export interface QueueRunnerOptions {
  db: AgentDeskDb;
  settings: Settings;
  dataDir?: string;
}

type StartTaskFn = (opts: QueueRunnerOptions, taskId: string) => Promise<Task>;

/** True when this process still owns a live AbortController for the task. */
export type LiveTaskCheck = (taskId: string) => boolean;

/** Abort a live runner (e.g. idle timeout). Returns false if not running here. */
export type AbortLiveTaskFn = (taskId: string, reason: string) => boolean;

export interface TaskQueueHooks {
  isLive?: LiveTaskCheck;
  abortLive?: AbortLiveTaskFn;
}

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function resolveProjectDir(task: Task): string {
  return path.resolve(task.projectDir || process.cwd());
}

function appendResultStamp(prev: string | undefined, tag: string, message: string): string {
  const stamp = `\n\n${new Date().toISOString()} [${tag}] ${message}`;
  const body = (prev || "").trim();
  return body ? `${body}${stamp}` : stamp.trimStart();
}

function publishReclaimed(task: Task): void {
  publishTaskUpdate({ task, resultAppend: undefined });
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

/** Failures that won't clear by waiting (missing CLI / backend / ghost status). */
export function isNonRetryableFailure(code: TaskFailureCode | string | undefined): boolean {
  return (
    code === "spawn_error" ||
    code === "backend_unavailable" ||
    code === "orphan_after_restart" ||
    code === "idle_timeout"
  );
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

/**
 * Mark DB `running`/`created` tasks with no in-process runner as failed.
 * Releases workspace locks so queued siblings can start after restart / crash.
 */
export function reclaimOrphanActiveTasks(
  opts: QueueRunnerOptions,
  isLive: LiveTaskCheck = () => false,
): Task[] {
  const reclaimed: Task[] = [];
  const msg = "进程已丢失（服务重启或 CLI 异常退出），已自动结束以释放工作区";
  for (const task of opts.db.listTasks(500)) {
    if (task.status !== "running" && task.status !== "created") continue;
    if (isLive(task.id)) continue;
    const now = Date.now();
    const updated = opts.db.updateTask(task.id, {
      status: "failed",
      failureCode: "orphan_after_restart",
      failureMessage: msg,
      nextRetryAt: 0,
      result: appendResultStamp(task.result, "orphan", msg),
      lastActivityAt: now,
    });
    if (!updated) continue;
    console.warn(`[agent-desk] reclaimed orphan task ${task.id}`);
    publishReclaimed(updated);
    reclaimed.push(updated);
  }
  return reclaimed;
}

/**
 * Abort live runners that have had no activity past idleTimeoutSec,
 * and reclaim any DB-active tasks that are no longer live in this process.
 */
export function sweepIdleAndOrphanTasks(
  opts: QueueRunnerOptions,
  hooks: TaskQueueHooks = {},
): { reclaimed: Task[]; aborted: string[] } {
  const isLive = hooks.isLive ?? (() => false);
  const abortLive = hooks.abortLive;
  const reclaimed = reclaimOrphanActiveTasks(opts, isLive);
  const aborted: string[] = [];

  const settings = opts.db.getSettings();
  const idleSec = Math.max(60, Number(settings.idleTimeoutSec ?? 3600) || 3600);
  const idleMs = idleSec * 1000;
  const now = Date.now();

  if (abortLive) {
    for (const task of opts.db.listTasks(500)) {
      if (task.status !== "running") continue;
      if (!isLive(task.id)) continue;
      const last = Number(task.lastActivityAt || task.updatedAt || 0);
      if (!last || now - last < idleMs) continue;
      if (abortLive(task.id, "idle_timeout")) {
        aborted.push(task.id);
        console.warn(
          `[agent-desk] aborted idle task ${task.id} (no activity for ${idleSec}s)`,
        );
      }
    }
  }

  return { reclaimed, aborted };
}

function kickQueuesForTasks(
  opts: QueueRunnerOptions,
  startTask: StartTaskFn,
  tasks: Task[],
): void {
  const dirs = new Set(tasks.map((t) => resolveProjectDir(t)));
  for (const dir of dirs) {
    void processWorkspaceQueue(opts, dir, startTask);
  }
}

export function bootstrapTaskQueue(
  opts: QueueRunnerOptions,
  startTask: StartTaskFn,
  hooks: TaskQueueHooks = {},
): void {
  const isLive = hooks.isLive ?? (() => false);
  const reclaimed = reclaimOrphanActiveTasks(opts, isLive);
  kickQueuesForTasks(opts, startTask, reclaimed);

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

/** Periodic orphan reclaim + idle abort. Safe to call once per process. */
export function startTaskWatchdog(
  opts: QueueRunnerOptions,
  startTask: StartTaskFn,
  hooks: TaskQueueHooks,
  intervalMs = 30_000,
): () => void {
  stopTaskWatchdog();
  const tick = () => {
    try {
      const { reclaimed } = sweepIdleAndOrphanTasks(opts, hooks);
      kickQueuesForTasks(opts, startTask, reclaimed);
    } catch (err) {
      console.error(`[agent-desk] task watchdog:`, err);
    }
  };
  watchdogTimer = setInterval(tick, Math.max(5_000, intervalMs));
  // Unref so watchdog alone does not keep the process alive in tests / short CLI.
  if (typeof watchdogTimer.unref === "function") watchdogTimer.unref();
  return stopTaskWatchdog;
}

export function stopTaskWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

export function failureCodeFromError(err: unknown): TaskFailureCode {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/not found|ENOENT|command not found|spawn/i.test(msg)) return "spawn_error";
  if (/not installed|requireReady|backend/i.test(msg)) return "backend_unavailable";
  return "start_error";
}
