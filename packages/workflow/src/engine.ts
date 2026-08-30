import {
  clipPrompt,
  clipTitle,
  newTaskId,
  newWorkflowRunId,
  type Settings,
  type Task,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunNode,
} from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import {
  createTask,
  enqueueStartTask,
  isTaskRunning,
  onTaskComplete,
  startTask,
  stopTask,
  type RunnerOptions,
} from "@agent-desk/runner";
import { getWorkflow } from "./loader.js";
import {
  appendSharedContext,
  buildIndependentPrompt,
  buildSharedContinuePrompt,
  buildSharedFirstPrompt,
} from "./prompts.js";
import { getRun, updateRunNode, writeRun } from "./store.js";

export { getWorkflow, listWorkflows, saveUserWorkflow, deleteUserWorkflow, userWorkflowsDir } from "./loader.js";
export { getRun, listRuns, writeRun } from "./store.js";

const activeWorkers = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function displayWorkflowStep(run: WorkflowRun): number {
  const total = run.nodes.length;
  if (!total) return 0;
  if (run.status === "done") return total;
  const done = run.nodes.filter((n) => n.status === "done" || n.status === "skipped").length;
  const idx = run.currentIndex;
  const cur = run.nodes[idx];
  if (cur?.status === "running" || cur?.status === "awaiting") return Math.max(done + 1, idx + 1);
  if (cur?.status === "done") return Math.max(done, idx + 1);
  return Math.min(Math.max(done, idx + 1), total);
}

function syncParentTask(db: AgentDeskDb, run: WorkflowRun): void {
  const parentId = run.parentTaskId;
  if (!parentId) return;
  const parent = db.getTask(parentId);
  if (!parent) return;

  let displaySt: Task["status"];
  if (run.mode === "shared") {
    if (run.status === "done") displaySt = "done";
    else if (run.status === "failed") displaySt = "failed";
    else if (run.status === "stopped") displaySt = "stopped";
    else if (run.status === "awaiting" || parent.status === "awaiting") displaySt = "awaiting";
    else displaySt = "running";
  } else {
    displaySt =
      run.status === "pending"
        ? "running"
        : (run.status as Task["status"]);
  }

  db.updateTask(parentId, {
    status: displaySt,
    workflowRunId: run.id,
    workflowStep: displayWorkflowStep(run),
    workflowStepTotal: run.nodes.length,
    lastActivityAt: parent.lastActivityAt,
  });
}

function persistRun(dataDir: string, db: AgentDeskDb, run: WorkflowRun): WorkflowRun {
  run.updatedAt = Date.now();
  writeRun(dataDir, run);
  syncParentTask(db, run);
  return run;
}

export function createWorkflowTask(
  db: AgentDeskDb,
  settings: Settings,
  workflow: Workflow,
  input: {
    title?: string;
    prompt?: string;
    projectDir?: string;
    issueCode?: string;
  },
): Task {
  const now = Date.now();
  const task: Task = {
    id: newTaskId(),
    taskType: "workflow",
    status: "created",
    skill: workflow.nodes[0]?.skill ?? "workflow",
    workflowId: workflow.id,
    workflowRunId: "",
    workflowName: workflow.name,
    workflowMode: workflow.mode,
    workflowStep: 0,
    workflowStepTotal: workflow.nodes.length,
    parentTaskId: "",
    workflowNodeIndex: null,
    projectDir: input.projectDir ?? process.cwd(),
    issueCode: input.issueCode ?? "",
    title: clipTitle(input.title ?? workflow.name),
    prompt: clipPrompt(input.prompt ?? ""),
    codingAgent: settings.codingAgent,
    sessionId: "",
    result: "",
    gateNotifyHash: "",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  };
  db.upsertTask(task);
  return task;
}

function buildRunNodes(workflow: Workflow): WorkflowRunNode[] {
  return workflow.nodes.map((n) => ({
    nodeId: n.id,
    skill: n.skill,
    title: n.title,
    prompt: n.prompt,
    taskId: "",
    status: "pending" as const,
  }));
}

async function waitForTaskEnd(db: AgentDeskDb, taskId: string, timeoutMs = 3_600_000): Promise<Task> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = db.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!isTaskRunning(taskId)) {
      if (["awaiting", "done", "failed", "stopped"].includes(task.status)) return task;
    }
    await sleep(800);
  }
  throw new Error(`Task timeout: ${taskId}`);
}

function syncIndependentRun(dataDir: string, db: AgentDeskDb, run: WorkflowRun): WorkflowRun {
  let anyRunning = false;
  let awaitingId = "";
  const statuses: string[] = [];

  for (let i = 0; i < run.nodes.length; i++) {
    const node = run.nodes[i];
    const tid = node.taskId;
    if (!tid) {
      statuses.push("failed");
      continue;
    }
    if (isTaskRunning(tid)) {
      anyRunning = true;
      statuses.push("running");
      if (node.status !== "running") run = updateRunNode(dataDir, run, i, { status: "running" });
      continue;
    }
    const task = db.getTask(tid);
    const st = task?.status ?? "failed";
    statuses.push(st);
    if (st === "awaiting" && !awaitingId) awaitingId = tid;
    if (st !== node.status || (task?.result && task.result !== node.result)) {
      run = updateRunNode(dataDir, run, i, { status: st as WorkflowRunNode["status"], result: task?.result ?? "" });
    }
  }

  if (anyRunning) run.status = "running";
  else if (statuses.some((s) => s === "awaiting")) {
    run.status = "awaiting";
    run.awaitingTaskId = awaitingId;
  } else if (statuses.some((s) => s === "failed")) run.status = "failed";
  else if (statuses.some((s) => s === "stopped")) run.status = "stopped";
  else if (statuses.length && statuses.every((s) => s === "done" || s === "skipped")) run.status = "done";
  else run.status = "running";

  run.awaitingTaskId = run.status === "awaiting" ? awaitingId : "";
  return persistRun(dataDir, db, run);
}

async function runShared(dataDir: string, opts: RunnerOptions, runId: string): Promise<void> {
  let run = getRun(dataDir, runId);
  if (!run) return;
  const parentId = run.parentTaskId;
  if (!parentId) {
    run.status = "failed";
    persistRun(dataDir, opts.db, run);
    return;
  }

  run.status = "running";
  run = persistRun(dataDir, opts.db, run);

  const wf = getWorkflow(dataDir, run.workflowId);
  if (!wf) {
    run.status = "failed";
    persistRun(dataDir, opts.db, run);
    return;
  }

  let sharedContext = run.sharedContext;
  let inputPrompt = run.inputPrompt;

  for (let i = run.currentIndex; i < run.nodes.length; i++) {
    run = getRun(dataDir, runId)!;
    const node = run.nodes[i];
    if (node.status === "done" || node.status === "skipped") continue;

    const wfNode = wf.nodes[i];
    const stepPrompt =
      i === 0
        ? buildSharedFirstPrompt(
            run.workflowName,
            wfNode,
            i,
            run.nodes.length,
            sharedContext,
            inputPrompt,
            run.nodes,
          )
        : buildSharedContinuePrompt(run.workflowName, wfNode, i, run.nodes.length, run.nodes);

    if (i === run.currentIndex) inputPrompt = "";

    run = updateRunNode(dataDir, run, i, { taskId: parentId, status: "running" });
    run.currentIndex = i;
    run = persistRun(dataDir, opts.db, run);

    opts.db.updateTask(parentId, {
      skill: wfNode.skill,
      prompt: clipPrompt(stepPrompt),
      status: "created",
      workflowNodeIndex: i,
      gateNotifyHash: "",
    });

    await startTask(opts, parentId);
    let task: Task;
    try {
      task = await waitForTaskEnd(opts.db, parentId);
    } catch {
      run = updateRunNode(dataDir, run, i, { status: "failed" });
      run.status = "failed";
      persistRun(dataDir, opts.db, run);
      return;
    }

    run = updateRunNode(dataDir, run, i, {
      status: task.status as WorkflowRunNode["status"],
      result: task.result,
    });

    if (task.status === "awaiting") {
      run.status = "awaiting";
      run.awaitingTaskId = parentId;
      persistRun(dataDir, opts.db, run);
      return;
    }
    if (task.status === "stopped") {
      run.status = "stopped";
      persistRun(dataDir, opts.db, run);
      return;
    }
    if (task.status === "failed") {
      run.status = "failed";
      persistRun(dataDir, opts.db, run);
      return;
    }

    sharedContext = appendSharedContext(sharedContext, node, task.result);
    run.sharedContext = sharedContext;
    run = updateRunNode(dataDir, run, i, { status: "done" });
    run.currentIndex = i + 1;
    run = persistRun(dataDir, opts.db, run);
  }

  run = getRun(dataDir, runId)!;
  run.status = "done";
  run.currentIndex = run.nodes.length;
  persistRun(dataDir, opts.db, run);
  opts.db.updateTask(parentId, { status: "done" });
}

async function runIndependent(dataDir: string, opts: RunnerOptions, runId: string): Promise<void> {
  let run = getRun(dataDir, runId);
  if (!run) return;
  const wf = getWorkflow(dataDir, run.workflowId);
  if (!wf) {
    run.status = "failed";
    persistRun(dataDir, opts.db, run);
    return;
  }

  run.status = "running";
  run = persistRun(dataDir, opts.db, run);

  const parent = run.parentTaskId ? opts.db.getTask(run.parentTaskId) : null;

  for (let i = 0; i < run.nodes.length; i++) {
    const wfNode = wf.nodes[i];
    const prompt = buildIndependentPrompt(wfNode, i === 0 ? run.inputPrompt : "");
    const child = createTask(
      {
        title: clipTitle(`${run.workflowName} · ${wfNode.title}`),
        prompt,
        projectDir: run.projectDir,
        issueCode: run.issueCode,
        skill: wfNode.skill,
        codingAgent: parent?.codingAgent,
      },
      opts.settings,
    );
    const childTask: Task = {
      ...child,
      taskType: "workflow",
      workflowId: run.workflowId,
      workflowRunId: run.id,
      workflowName: run.workflowName,
      workflowMode: "independent",
      workflowNodeIndex: i,
      parentTaskId: run.parentTaskId,
    };
    opts.db.upsertTask(childTask);
    run = updateRunNode(dataDir, run, i, { taskId: childTask.id, status: "running" });
    run = persistRun(dataDir, opts.db, run);
    enqueueStartTask(opts, childTask.id);
  }

  const deadline = Date.now() + 3_600_000;
  while (Date.now() < deadline) {
    run = syncIndependentRun(dataDir, opts.db, getRun(dataDir, runId)!);
    if (["done", "failed", "awaiting", "stopped"].includes(run.status)) return;
    await sleep(1500);
  }
  run.status = "failed";
  persistRun(dataDir, opts.db, run);
}

async function worker(dataDir: string, opts: RunnerOptions, runId: string): Promise<void> {
  try {
    const run = getRun(dataDir, runId);
    if (!run) return;
    if (run.mode === "independent") await runIndependent(dataDir, opts, runId);
    else await runShared(dataDir, opts, runId);
  } finally {
    activeWorkers.delete(runId);
  }
}

function launchWorker(dataDir: string, opts: RunnerOptions, runId: string): void {
  if (activeWorkers.has(runId)) return;
  activeWorkers.add(runId);
  void worker(dataDir, opts, runId);
}

export interface StartRunInput {
  workflowId: string;
  projectDir?: string;
  inputPrompt?: string;
  issueCode?: string;
  parentTaskId?: string;
  title?: string;
}

export function startRun(dataDir: string, opts: RunnerOptions, input: StartRunInput): WorkflowRun {
  const wf = getWorkflow(dataDir, input.workflowId);
  if (!wf) throw new Error(`Workflow not found: ${input.workflowId}`);

  let parentTask: Task | null = null;
  if (input.parentTaskId) {
    parentTask = opts.db.getTask(input.parentTaskId);
    if (!parentTask) throw new Error(`Parent task not found: ${input.parentTaskId}`);
  } else {
    parentTask = createWorkflowTask(opts.db, opts.settings, wf, {
      title: input.title,
      prompt: input.inputPrompt,
      projectDir: input.projectDir,
      issueCode: input.issueCode,
    });
  }

  const now = Date.now();
  const run: WorkflowRun = {
    id: newWorkflowRunId(),
    workflowId: wf.id,
    workflowName: wf.name,
    mode: wf.mode,
    projectDir: input.projectDir ?? parentTask.projectDir ?? process.cwd(),
    inputPrompt: clipPrompt(input.inputPrompt ?? parentTask.prompt ?? ""),
    issueCode: input.issueCode ?? parentTask.issueCode ?? "",
    parentTaskId: parentTask.id,
    status: "pending",
    currentIndex: 0,
    sharedContext: "",
    awaitingTaskId: "",
    nodes: buildRunNodes(wf),
    createdAt: now,
    updatedAt: now,
  };

  writeRun(dataDir, run);
  opts.db.updateTask(parentTask.id, {
    taskType: "workflow",
    workflowId: wf.id,
    workflowRunId: run.id,
    workflowName: wf.name,
    workflowMode: wf.mode,
    workflowStepTotal: wf.nodes.length,
    status: "running",
  });

  launchWorker(dataDir, opts, run.id);
  return getRun(dataDir, run.id)!;
}

export function continueRun(dataDir: string, opts: RunnerOptions, runId: string): WorkflowRun {
  if (activeWorkers.has(runId)) {
    const run = getRun(dataDir, runId);
    if (run) return run;
    throw new Error("Workflow is already running");
  }
  const run = getRun(dataDir, runId);
  if (!run) throw new Error(`Workflow run not found: ${runId}`);
  if (run.mode !== "shared") throw new Error("Only shared mode supports continue");
  if (run.status !== "awaiting" && run.status !== "running") {
    throw new Error("Workflow is not awaiting confirmation");
  }

  const idx = run.currentIndex;
  const node = run.nodes[idx];
  if (node?.status === "done" && idx + 1 < run.nodes.length) {
    run.currentIndex = idx + 1;
    run.status = "running";
    run.awaitingTaskId = "";
    persistRun(dataDir, opts.db, run);
  } else if (node?.status === "done") {
    run.status = "done";
    persistRun(dataDir, opts.db, run);
    return run;
  } else {
    run.status = "running";
    run.awaitingTaskId = "";
    persistRun(dataDir, opts.db, run);
  }

  launchWorker(dataDir, opts, runId);
  return getRun(dataDir, runId)!;
}

export function stopRun(dataDir: string, opts: RunnerOptions, runId: string): WorkflowRun {
  let run = getRun(dataDir, runId);
  if (!run) throw new Error(`Workflow run not found: ${runId}`);

  if (run.mode === "shared" && run.parentTaskId) stopTask(run.parentTaskId);
  for (const node of run.nodes) {
    if (node.taskId) stopTask(node.taskId);
  }

  run.status = "stopped";
  for (let i = 0; i < run.nodes.length; i++) {
    if (run.nodes[i].status === "running" || run.nodes[i].status === "awaiting") {
      run = updateRunNode(dataDir, run, i, { status: "stopped" });
    }
  }
  return persistRun(dataDir, opts.db, run);
}

export function maybeAdvanceAfterStep(
  dataDir: string,
  opts: RunnerOptions,
  taskId: string,
): void {
  const task = opts.db.getTask(taskId);
  if (!task) return;
  const runId = task.workflowRunId;
  if (!runId || activeWorkers.has(runId)) return;

  const run = getRun(dataDir, runId);
  if (!run || run.mode !== "shared") return;

  const parentId = run.parentTaskId;
  const idx = run.currentIndex;
  if (idx >= run.nodes.length) return;

  const node = run.nodes[idx];
  if (parentId && taskId !== parentId) return;
  if (node.taskId && node.taskId !== taskId) return;

  const nodeSt = node.status;
  if (task.status !== "done" && nodeSt !== "done") return;

  let nextRun = run;
  if (task.status === "done") {
    nextRun = updateRunNode(dataDir, run, idx, { status: "done", result: task.result });
  }

  const canAdvance =
    nextRun.status === "awaiting" ||
    (nextRun.nodes[idx]?.status === "done" &&
      idx + 1 < nextRun.nodes.length &&
      nextRun.nodes[idx + 1]?.status === "pending");

  if (!canAdvance) return;

  try {
    continueRun(dataDir, opts, runId);
  } catch {
    // ignore race
  }
}

let hooksRegistered = false;

export function registerWorkflowHooks(dataDir: string, opts: RunnerOptions): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onTaskComplete((task) => {
    if (!task.workflowRunId) return;
    maybeAdvanceAfterStep(dataDir, opts, task.id);
    if (task.workflowRunId && task.parentTaskId) {
      const run = getRun(dataDir, task.workflowRunId);
      if (run?.mode === "independent") syncIndependentRun(dataDir, opts.db, run);
    }
  });
}

export function isWorkflowRunning(runId: string): boolean {
  return activeWorkers.has(runId);
}
