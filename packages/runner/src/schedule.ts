/**
 * Workspace conflict schedule check (for UI dialog).
 * Logical workspace = git toplevel when available, else projectDir.
 */
import path from "node:path";
import type { Task } from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import { gitToplevel } from "./worktree.js";

export type ScheduleMode = "auto" | "queue" | "parallel";

export type ScheduleBlocker = {
  id: string;
  title: string;
  status: Task["status"];
};

export type ScheduleCheckResult = {
  ok: boolean;
  needSchedule: boolean;
  reason: string;
  blockers: ScheduleBlocker[];
  parallelOk: boolean;
  workspaceKey: string;
};

const ACTIVE: ReadonlySet<Task["status"]> = new Set([
  "dispatched",
  "running",
  "awaiting",
]);

export function resolveWorkspaceKey(projectDir: string, workspaceRoot = ""): string {
  const root = (workspaceRoot || "").trim();
  if (root) return path.resolve(root);
  const dir = (projectDir || "").trim();
  if (!dir) return "";
  const resolved = path.resolve(dir);
  return gitToplevel(resolved) || resolved;
}

export function listWorkspaceBlockers(
  db: AgentDeskDb,
  projectDir: string,
  exceptId?: string,
): ScheduleBlocker[] {
  const key = resolveWorkspaceKey(projectDir);
  if (!key) return [];
  const except = (exceptId || "").trim();
  return db
    .listTasks(500)
    .filter((t) => {
      if (except && t.id === except) return false;
      if (!ACTIVE.has(t.status)) return false;
      const tKey = resolveWorkspaceKey(t.projectDir, t.workspaceRoot);
      return Boolean(tKey) && tKey === key;
    })
    .map((t) => ({
      id: t.id,
      title: (t.title || t.id).trim() || t.id,
      status: t.status,
    }));
}

export function checkTaskSchedule(
  db: AgentDeskDb,
  task: Task,
  opts?: { workspaceLockEnabled?: boolean; worktreeParallelEnabled?: boolean },
): ScheduleCheckResult {
  const lockOn = opts?.workspaceLockEnabled !== false;
  const dir = (task.projectDir || "").trim();
  const workspaceKey = resolveWorkspaceKey(dir, task.workspaceRoot);
  const parallelOk =
    opts?.worktreeParallelEnabled !== false && Boolean(gitToplevel(dir || workspaceKey));
  if (!lockOn || !workspaceKey) {
    return {
      ok: true,
      needSchedule: false,
      reason: "",
      blockers: [],
      parallelOk,
      workspaceKey,
    };
  }
  const blockers = listWorkspaceBlockers(db, dir || workspaceKey, task.id);
  if (!blockers.length) {
    return {
      ok: true,
      needSchedule: false,
      reason: "",
      blockers: [],
      parallelOk,
      workspaceKey,
    };
  }
  return {
    ok: false,
    needSchedule: true,
    reason: "此目录已有任务在进行",
    blockers,
    parallelOk,
    workspaceKey,
  };
}
