import { randomUUID } from "node:crypto";
import os from "node:os";
import type { Task } from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import type { QueueRunnerOptions } from "./queue.js";
import { publishTaskUpdate } from "./task-events.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_LEASE_TTL_MS = 45_000;
export const DEFAULT_POLL_INTERVAL_MS = 2_000;

export interface LocalExecutorStatus {
  id: string;
  mode: "in_process";
  online: boolean;
  hostname: string;
  pid: number;
  startedAt: number;
  lastHeartbeatAt: number;
  lastPollAt: number;
  maxConcurrent: number;
  slotCount: number;
  claimedTaskIds: string[];
}

export interface LocalExecutorHandle {
  id: string;
  stop: () => void;
  wake: () => void;
  getStatus: () => LocalExecutorStatus;
}

type StartTaskFn = (opts: QueueRunnerOptions, taskId: string) => Promise<Task>;

export interface StartLocalExecutorOptions extends QueueRunnerOptions {
  startTask: StartTaskFn;
  /** Override executor id (tests). Default: local-<hostname>-<pid>. */
  executorId?: string;
  heartbeatIntervalMs?: number;
  leaseTtlMs?: number;
  pollIntervalMs?: number;
}

let active: LocalExecutorHandle | null = null;
let wakeQueued = false;

/** Wake the in-process executor (no-op if not started). */
export function requestExecutorWake(): void {
  if (active) {
    active.wake();
    return;
  }
  wakeQueued = true;
}

export function getLocalExecutor(): LocalExecutorHandle | null {
  return active;
}

export function defaultExecutorId(): string {
  const host = (os.hostname() || "localhost").replace(/[^\w.-]+/g, "-").slice(0, 48);
  return `local-${host}-${process.pid}`;
}

function resolveMaxConcurrent(db: AgentDeskDb): number {
  const n = Number(db.getSettings().executorMaxConcurrent ?? 4);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * In-process execution plane: claim queued tasks under a heartbeat lease, then spawn CLI.
 * Control plane (HTTP / Autopilot) only enqueues and wakes this loop.
 */
export function startLocalExecutor(opts: StartLocalExecutorOptions): LocalExecutorHandle {
  if (active) {
    active.stop();
  }

  const id = (opts.executorId || defaultExecutorId()).trim() || defaultExecutorId();
  const heartbeatIntervalMs = Math.max(5_000, opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  const leaseTtlMs = Math.max(heartbeatIntervalMs * 2, opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS);
  const pollIntervalMs = Math.max(500, opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

  const startedAt = Date.now();
  let lastHeartbeatAt = 0;
  let lastPollAt = 0;
  let stopped = false;
  let ticking = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;

  const runnerOpts: QueueRunnerOptions = {
    db: opts.db,
    settings: opts.settings,
    dataDir: opts.dataDir,
  };

  const listOwned = (): Task[] =>
    opts.db
      .listTasks(500)
      .filter(
        (t) =>
          t.claimedBy === id &&
          (t.status === "dispatched" || t.status === "running") &&
          Boolean(t.claimToken),
      );

  const getStatus = (): LocalExecutorStatus => {
    const owned = listOwned();
    return {
      id,
      mode: "in_process",
      online: !stopped,
      hostname: os.hostname(),
      pid: process.pid,
      startedAt,
      lastHeartbeatAt,
      lastPollAt,
      maxConcurrent: resolveMaxConcurrent(opts.db),
      slotCount: owned.length,
      claimedTaskIds: owned.map((t) => t.id),
    };
  };

  const heartbeat = (): void => {
    if (stopped) return;
    const now = Date.now();
    lastHeartbeatAt = now;
    for (const task of listOwned()) {
      opts.db.heartbeatTaskClaim(task.id, task.claimToken, id, now);
    }
  };

  const reclaimStale = (): void => {
    const reclaimed = opts.db.reclaimStaleDispatchedClaims(leaseTtlMs);
    for (const task of reclaimed) {
      console.warn(`[agent-desk] reclaimed stale claim ${task.id}`);
      publishTaskUpdate({ task, resultAppend: undefined });
    }
  };

  const freeSlots = (): number => {
    const max = resolveMaxConcurrent(opts.db);
    if (max <= 0) return 64;
    const used = opts.db.countExecutorSlots(id);
    return Math.max(0, max - used);
  };

  const claimAndStart = async (): Promise<void> => {
    let slots = freeSlots();
    while (slots > 0 && !stopped) {
      const settings = opts.db.getSettings();
      const claimed = opts.db.claimNextQueuedTask({
        executorId: id,
        claimToken: randomUUID(),
        workspaceLockEnabled: settings.workspaceLockEnabled !== false,
      });
      if (!claimed) break;
      publishTaskUpdate({ task: claimed, resultAppend: undefined });
      slots -= 1;
      console.log(`[agent-desk] executor ${id} claimed ${claimed.id}`);
      void opts.startTask(runnerOpts, claimed.id).catch((err) => {
        console.error(
          `[agent-desk] executor start ${claimed.id}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      lastPollAt = Date.now();
      reclaimStale();
      await claimAndStart();
    } catch (err) {
      console.error(`[agent-desk] executor tick:`, err);
    } finally {
      ticking = false;
    }
  };

  const wake = (): void => {
    if (stopped) return;
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void tick();
    }, 0);
  };

  pollTimer = setInterval(() => void tick(), pollIntervalMs);
  if (typeof pollTimer.unref === "function") pollTimer.unref();

  heartbeatTimer = setInterval(heartbeat, heartbeatIntervalMs);
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  heartbeat();

  const handle: LocalExecutorHandle = {
    id,
    stop: () => {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (wakeTimer) clearTimeout(wakeTimer);
      pollTimer = null;
      heartbeatTimer = null;
      wakeTimer = null;
      if (active === handle) active = null;
    },
    wake,
    getStatus,
  };

  active = handle;
  console.log(
    `[executor] in-process ${id} (heartbeat ${Math.round(heartbeatIntervalMs / 1000)}s, lease ${Math.round(leaseTtlMs / 1000)}s)`,
  );
  if (wakeQueued) {
    wakeQueued = false;
    wake();
  } else {
    wake();
  }
  return handle;
}

export function stopLocalExecutor(): void {
  active?.stop();
  active = null;
}
