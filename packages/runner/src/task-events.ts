import type { Task } from "@agent-desk/core";

export interface TaskStreamUpdate {
  task: Task;
  /** New bytes appended to task.result since the previous publish for this task. */
  resultAppend?: string;
}

export type TaskUpdateListener = (update: TaskStreamUpdate) => void;

const listenersByTask = new Map<string, Set<TaskUpdateListener>>();

export function subscribeTaskUpdates(taskId: string, listener: TaskUpdateListener): () => void {
  let set = listenersByTask.get(taskId);
  if (!set) {
    set = new Set();
    listenersByTask.set(taskId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listenersByTask.delete(taskId);
  };
}

export function publishTaskUpdate(update: TaskStreamUpdate): void {
  const set = listenersByTask.get(update.task.id);
  if (!set?.size) return;
  for (const listener of set) {
    try {
      listener(update);
    } catch (err) {
      console.error(
        `[agent-desk] task update listener failed for ${update.task.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
