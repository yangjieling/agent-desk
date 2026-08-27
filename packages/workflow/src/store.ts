import fs from "node:fs";
import path from "node:path";
import type { WorkflowRun, WorkflowRunNode } from "@agent-desk/core";

function runsDir(dataDir: string): string {
  return path.join(dataDir, "workflow-runs");
}

function runFile(dataDir: string, runId: string): string {
  return path.join(runsDir(dataDir), `${runId}.json`);
}

function fromJson(data: Record<string, unknown>): WorkflowRun {
  const nodes = Array.isArray(data.nodes)
    ? data.nodes.map((n) => {
        const rec = n as Record<string, unknown>;
        return {
          nodeId: String(rec.nodeId ?? rec.node_id ?? ""),
          skill: String(rec.skill ?? ""),
          title: String(rec.title ?? ""),
          prompt: String(rec.prompt ?? ""),
          taskId: String(rec.taskId ?? rec.task_id ?? ""),
          status: (rec.status ?? "pending") as WorkflowRunNode["status"],
          result: rec.result ? String(rec.result) : undefined,
          error: rec.error ? String(rec.error) : undefined,
        };
      })
    : [];
  return {
    id: String(data.id),
    workflowId: String(data.workflowId ?? data.workflow_id ?? ""),
    workflowName: String(data.workflowName ?? data.workflow_name ?? ""),
    mode: (data.mode ?? "shared") as WorkflowRun["mode"],
    projectDir: String(data.projectDir ?? data.project_dir ?? ""),
    inputPrompt: String(data.inputPrompt ?? data.input_prompt ?? ""),
    issueCode: String(data.issueCode ?? data.issue_code ?? ""),
    parentTaskId: String(data.parentTaskId ?? data.parent_task_id ?? ""),
    status: (data.status ?? "pending") as WorkflowRun["status"],
    currentIndex: Number(data.currentIndex ?? data.current_index ?? 0),
    sharedContext: String(data.sharedContext ?? data.shared_context ?? ""),
    awaitingTaskId: String(data.awaitingTaskId ?? data.awaiting_task_id ?? ""),
    nodes,
    createdAt: Number(data.createdAt ?? data.created_at ?? 0),
    updatedAt: Number(data.updatedAt ?? data.updated_at ?? 0),
  };
}

export function writeRun(dataDir: string, run: WorkflowRun): void {
  fs.mkdirSync(runsDir(dataDir), { recursive: true });
  fs.writeFileSync(runFile(dataDir, run.id), JSON.stringify(run, null, 2), "utf8");
}

export function getRun(dataDir: string, runId: string): WorkflowRun | null {
  const fp = runFile(dataDir, runId);
  if (!fs.existsSync(fp)) return null;
  try {
    return fromJson(JSON.parse(fs.readFileSync(fp, "utf8")) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function listRuns(dataDir: string, limit = 50): WorkflowRun[] {
  const dir = runsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  const items: WorkflowRun[] = [];
  for (const fp of fs.readdirSync(dir)) {
    if (!fp.endsWith(".json")) continue;
    const run = getRun(dataDir, fp.replace(/\.json$/, ""));
    if (run) items.push(run);
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export function updateRunNode(
  dataDir: string,
  run: WorkflowRun,
  index: number,
  patch: Partial<WorkflowRunNode>,
): WorkflowRun {
  if (index < 0 || index >= run.nodes.length) return run;
  run.nodes[index] = { ...run.nodes[index], ...patch };
  run.updatedAt = Date.now();
  writeRun(dataDir, run);
  return run;
}
