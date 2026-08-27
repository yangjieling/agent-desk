import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  clipPrompt,
  clipTitle,
  isAbortReply,
  looksLikeQuestion,
  looksLikeUserAbort,
  newTaskId,
  parseGate,
  type Settings,
  type Task,
} from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import { getAgentBackend } from "@agent-desk/provider-agent";
import { getNotifyProvider } from "@agent-desk/provider-notify";

export interface CreateTaskInput {
  title: string;
  prompt: string;
  projectDir?: string;
  issueCode?: string;
  skill?: string;
  codingAgent?: string;
}

export interface RunnerOptions {
  db: AgentDeskDb;
  settings: Settings;
}

const running = new Map<string, AbortController>();

type TaskCompleteHandler = (task: Task) => void | Promise<void>;
const completeHandlers: TaskCompleteHandler[] = [];

export function onTaskComplete(handler: TaskCompleteHandler): void {
  completeHandlers.push(handler);
}

async function emitTaskComplete(task: Task): Promise<void> {
  for (const handler of completeHandlers) {
    await handler(task);
  }
}

export function createTask(input: CreateTaskInput, settings: Settings): Task {
  const now = Date.now();
  return {
    id: newTaskId(),
    taskType: "skill",
    status: "created",
    skill: input.skill ?? "default",
    workflowId: "",
    workflowRunId: "",
    workflowName: "",
    workflowMode: "",
    workflowStep: 0,
    workflowStepTotal: 0,
    parentTaskId: "",
    workflowNodeIndex: null,
    projectDir: input.projectDir ?? process.cwd(),
    issueCode: input.issueCode ?? "",
    title: clipTitle(input.title),
    prompt: clipPrompt(input.prompt),
    codingAgent: input.codingAgent ?? settings.codingAgent,
    sessionId: "",
    result: "",
    gateNotifyHash: "",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  };
}

function promptPath(taskId: string): string {
  const dir = path.join(os.tmpdir(), "agent-desk", "prompts");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${taskId}.md`);
}

function gateHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function maybeNotifyGate(task: Task, settings: Settings): Promise<void> {
  if (!settings.notifyEnabled) return;
  const gate = parseGate(task.result);
  if (!gate) return;
  const hash = gateHash(task.result);
  if (task.gateNotifyHash === hash) return;
  const notify = getNotifyProvider(settings.providers.notify);
  await notify.sendGate({
    taskId: task.id,
    title: task.title,
    gateHeading: gate.heading,
    choices: gate.choices,
    webUrl: `${settings.webBaseUrl}/?task=${task.id}`,
    issueCode: task.issueCode || undefined,
  });
}

export async function startTask(opts: RunnerOptions, taskId: string): Promise<Task> {
  const task = opts.db.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (running.has(taskId)) return task;

  const backend = getAgentBackend(task.codingAgent || opts.settings.codingAgent);
  await backend.requireReady();

  const controller = new AbortController();
  running.set(taskId, controller);

  const cwd = task.projectDir || process.cwd();
  const promptFile = promptPath(task.id);
  fs.writeFileSync(promptFile, task.prompt, "utf8");

  const args = task.sessionId
    ? backend.buildResumeCommand({ cwd, promptFile, sessionId: task.sessionId })
    : backend.buildExecCommand({ cwd, promptFile });

  opts.db.updateTask(taskId, { status: "running" });

  const child = spawn(args[0], args.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    signal: controller.signal,
    env: process.env,
  });

  let output = task.result ? `${task.result}\n` : "";
  const events: import("@agent-desk/provider-agent").AgentEvent[] = [];

  const onData = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    for (const line of text.split("\n")) {
      const evt = backend.parseEventLine(line);
      if (evt) events.push(evt);
    }
    opts.db.updateTask(taskId, { result: output, lastActivityAt: Date.now() });
  };

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  child.on("close", async (code) => {
    running.delete(taskId);
    const sessionId = backend.extractSessionId(events) ?? task.sessionId;
    let status: Task["status"] = code === 0 ? "done" : "failed";
    if (controller.signal.aborted) status = "stopped";
    if (looksLikeUserAbort(output)) status = "stopped";
    if (looksLikeQuestion(output) && status !== "stopped" && status !== "failed") {
      status = "awaiting";
    }

    const updated = opts.db.updateTask(taskId, {
      status,
      sessionId,
      result: output,
    });
    if (updated) {
      if (status === "awaiting") {
        await maybeNotifyGate(updated, opts.settings);
        opts.db.updateTask(taskId, { gateNotifyHash: gateHash(output) });
      }
      await emitTaskComplete(updated);
    }
  });

  return opts.db.getTask(taskId)!;
}

export function stopTask(taskId: string, reason = "user_stop"): boolean {
  const controller = running.get(taskId);
  if (!controller) return false;
  controller.abort(reason);
  running.delete(taskId);
  return true;
}

export async function resumeTask(
  opts: RunnerOptions,
  taskId: string,
  reply: string,
): Promise<Task> {
  const task = opts.db.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  if (isAbortReply(reply)) {
    stopTask(taskId, "abort_reply");
    const updated = opts.db.updateTask(taskId, {
      status: "stopped",
      result: `${task.result}\n\n[user abort: ${reply}]`,
    });
    if (updated) await emitTaskComplete(updated);
    return updated!;
  }

  const prompt = reply.trim() === "继续" || reply.trim().toLowerCase() === "continue"
    ? "Continue from where we left off."
    : reply;

  opts.db.updateTask(taskId, {
    status: "created",
    prompt: clipPrompt(`${task.prompt}\n\n---\nUser reply:\n${prompt}`),
  });

  return startTask(opts, taskId);
}

export function isTaskRunning(taskId: string): boolean {
  return running.has(taskId);
}
