import type { Task } from "@agent-desk/core";

export type TaskUpdateListener = (task: Task) => void;

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

export function publishTaskUpdate(task: Task): void {
  const set = listenersByTask.get(task.id);
  if (!set?.size) return;
  for (const listener of set) {
    try {
      listener(task);
    } catch (err) {
      console.error(
        `[agent-desk] task update listener failed for ${task.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
