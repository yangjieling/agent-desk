import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  appendDangerousCommandApproval,
  clipPrompt,
  clipTitle,
  dangerousCommandId,
  extractPendingDangerousCommand,
  formatDangerousCommandGate,
  isAbortReply,
  isDangerousCommandApproval,
  agentPromptBodyForRun,
  matchDangerousCommand,
  newTaskId,
  parseApprovedDangerousCommandIds,
  parseGate,
  resolveTaskStatusAfterRun,
  type Settings,
  type Task,
} from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import { getAgentBackend } from "@agent-desk/provider-agent";
import {
  ensureIssueWorkspace,
  maybeReleaseAutoWorkspace,
} from "@agent-desk/provider-issue-github";
import { getNotifyProvider } from "@agent-desk/provider-notify";
import { mountSkill } from "@agent-desk/skills";
import {
  createLogLinePrefixer,
  formatCommandLogLine,
  formatLogTimestamp,
} from "./log-format.js";
import { publishTaskUpdate } from "./task-events.js";

export { subscribeTaskUpdates } from "./task-events.js";

export interface CreateTaskInput {
  title: string;
  prompt: string;
  projectDir?: string;
  issueCode?: string;
  skill?: string;
  codingAgent?: string;
  model?: string;
}

export interface RunnerOptions {
  db: AgentDeskDb;
  /** @deprecated Snapshot only; use resolveSettings(opts) for live values. */
  settings: Settings;
  /** ~/.agent-desk — used for GitHub auto-clone workspaces. */
  dataDir?: string;
}

/** Always read current settings from SQLite (not the runnerOpts snapshot). */
export function resolveSettings(opts: RunnerOptions): Settings {
  return opts.db.getSettings();
}

const running = new Map<string, AbortController>();
const publishTimers = new Map<string, ReturnType<typeof setTimeout>>();

function notifyTaskUpdate(opts: RunnerOptions, taskOrId: string | Task, immediate = false): void {
  const emit = () => {
    const task = typeof taskOrId === "string" ? opts.db.getTask(taskOrId) : taskOrId;
    if (task) publishTaskUpdate(task);
  };
  const taskId = typeof taskOrId === "string" ? taskOrId : taskOrId.id;
  if (immediate) {
    const pending = publishTimers.get(taskId);
    if (pending) clearTimeout(pending);
    publishTimers.delete(taskId);
    emit();
    return;
  }
  if (publishTimers.has(taskId)) return;
  publishTimers.set(
    taskId,
    setTimeout(() => {
      publishTimers.delete(taskId);
      emit();
    }, 80),
  );
}

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
    model: input.model ?? settings.defaultModel ?? "",
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

function webUrlFor(task: Task, settings: Settings): string {
  return `${settings.webBaseUrl}/?task=${task.id}`;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err ?? "unknown error");
}

async function markTaskFailed(
  opts: RunnerOptions,
  taskId: string,
  err: unknown,
): Promise<Task> {
  const prev = opts.db.getTask(taskId);
  const msg = errMessage(err);
  const stamp = `\n\n${formatLogTimestamp()} [start error] ${msg}`;
  const result = prev?.result?.trim()
    ? `${prev.result.trim()}${stamp}`
    : `${formatLogTimestamp()} [start error] ${msg}`;
  const updated = opts.db.updateTask(taskId, {
    status: "failed",
    result,
    lastActivityAt: Date.now(),
  });
  const task = updated ?? prev;
  if (task) {
    publishTaskUpdate(task);
    await maybeNotifyTaskUpdate(task, resolveSettings(opts));
    await emitTaskComplete(task);
  }
  if (!task) throw new Error(`Task not found after fail: ${taskId}`);
  return task;
}

async function safeNotify(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(
      `[agent-desk] ${label} failed:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function maybeNotifyGate(task: Task, settings: Settings): Promise<boolean> {
  if (!settings.notifyEnabled) return false;
  const gate = parseGate(task.result);
  if (!gate) return false;
  const hash = gateHash(task.result);
  if (task.gateNotifyHash === hash) return false;
  const notify = getNotifyProvider(settings.providers.notify);
  return safeNotify("gate notify", () =>
    notify.sendGate({
      taskId: task.id,
      title: task.title,
      gateHeading: gate.heading,
      choices: gate.choices,
      webUrl: webUrlFor(task, settings),
      issueCode: task.issueCode || undefined,
    }),
  );
}

async function maybeReleaseTaskWorkspace(
  opts: RunnerOptions,
  task: Task,
  status: Task["status"],
): Promise<void> {
  if (!opts.dataDir || !task.projectDir) return;
  if (!["done", "failed", "stopped"].includes(status)) return;
  const active = opts.db.countActiveTasksForProjectDir(task.projectDir, task.id);
  await maybeReleaseAutoWorkspace(opts.dataDir, task.projectDir, active);
}

async function ensureTaskWorkspace(
  opts: RunnerOptions,
  task: Task,
): Promise<Task> {
  if (!opts.dataDir || !task.issueCode?.trim()) return task;
  if (resolveSettings(opts).providers.issue !== "github") return task;
  const ws = await ensureIssueWorkspace(opts.dataDir);
  if (task.projectDir === ws.projectDir) return task;
  const updated = opts.db.updateTask(task.id, { projectDir: ws.projectDir });
  return updated ?? task;
}

async function maybeNotifyTaskUpdate(task: Task, settings: Settings): Promise<void> {
  if (!settings.notifyEnabled) return;
  if (task.status !== "done" && task.status !== "failed") return;
  const notify = getNotifyProvider(settings.providers.notify);
  const snippet = (task.result || "").trim().slice(-400);
  await safeNotify("task update notify", () =>
    notify.sendTaskUpdate({
      taskId: task.id,
      title: task.title,
      status: task.status,
      message: snippet || `任务已${task.status === "done" ? "完成" : "失败"}`,
      webUrl: webUrlFor(task, settings),
      issueCode: task.issueCode || undefined,
    }),
  );
}

/**
 * Launch (or re-launch) a task's coding agent.
 * Launch failures are recorded as status=failed and do not reject, so
 * fire-and-forget callers cannot crash the web process.
 */
export async function startTask(opts: RunnerOptions, taskId: string): Promise<Task> {
  let task = opts.db.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (running.has(taskId)) return task;

  try {
    task = await ensureTaskWorkspace(opts, task);
    const taskSessionId = task.sessionId;

    const settings = resolveSettings(opts);
    const backend = getAgentBackend(task.codingAgent || settings.codingAgent);
    await backend.requireReady();

    const controller = new AbortController();
    running.set(taskId, controller);

    const cwd = task.projectDir || process.cwd();
    const skillMount = mountSkill(task.skill || "default", { cwd });
    const runPrompt = agentPromptBodyForRun(task.prompt, Boolean(task.sessionId));
    const promptBody = task.sessionId
      ? runPrompt
      : skillMount.promptPrefix
        ? `${skillMount.promptPrefix}\n${task.prompt}`
        : task.prompt;
    const promptFile = promptPath(task.id);
    fs.writeFileSync(promptFile, promptBody, "utf8");

    const execParams = {
      cwd,
      promptFile,
      extraSkillDirs: skillMount.extraSkillDirs,
      model: task.model || settings.defaultModel,
    };
    const args = task.sessionId
      ? backend.buildResumeCommand({ ...execParams, sessionId: task.sessionId })
      : backend.buildExecCommand(execParams);

    const runningTask = opts.db.updateTask(taskId, { status: "running" });
    notifyTaskUpdate(opts, runningTask ?? taskId, true);

    const child = spawn(args[0], args.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: controller.signal,
      env: process.env,
    });

    let output = task.result ? `${task.result}\n` : "";
    output += formatCommandLogLine(args);
    const linePrefixer = createLogLinePrefixer();
    const events: import("@agent-desk/provider-agent").AgentEvent[] = [];
    let settled = false;
    const approvedCommandIds = parseApprovedDangerousCommandIds(task.prompt);

    const finishDangerousCommandGate = async (
      match: import("@agent-desk/core").DangerousCommandMatch,
    ) => {
      if (settled) return;
      settled = true;
      running.delete(taskId);
      const tail = linePrefixer.flush();
      if (tail) output += tail;
      output += `\n\n${formatDangerousCommandGate(match)}\n`;
      const sessionId = backend.extractSessionId(events) ?? taskSessionId;
      try {
        controller.abort("dangerous_command_gate");
      } catch {
        /* ignore */
      }
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      const updated = opts.db.updateTask(taskId, {
        status: "awaiting",
        sessionId,
        result: output,
        lastActivityAt: Date.now(),
      });
      if (updated) {
        notifyTaskUpdate(opts, updated, true);
        const sent = await maybeNotifyGate(updated, settings);
        if (sent) opts.db.updateTask(taskId, { gateNotifyHash: gateHash(output) });
        await emitTaskComplete(updated);
      }
    };

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += linePrefixer.append(text);
      for (const line of text.split("\n")) {
        const evt = backend.parseEventLine(line);
        if (evt) {
          events.push(evt);
          if (
            !settled &&
            evt.type === "command" &&
            evt.command &&
            matchDangerousCommand(evt.command)
          ) {
            const cmdId = dangerousCommandId(evt.command);
            if (!approvedCommandIds.has(cmdId)) {
              void finishDangerousCommandGate(matchDangerousCommand(evt.command)!);
              break;
            }
          }
        }
      }
      if (!settled) {
        const updated = opts.db.updateTask(taskId, { result: output, lastActivityAt: Date.now() });
        if (updated) notifyTaskUpdate(opts, updated);
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      running.delete(taskId);
      console.error(`[agent-desk] task ${taskId} spawn error:`, errMessage(err));
      void markTaskFailed(opts, taskId, err);
    });

    child.on("close", async (code) => {
      if (settled) return;
      settled = true;
      running.delete(taskId);
      const tail = linePrefixer.flush();
      if (tail) output += tail;
      const sessionId = backend.extractSessionId(events) ?? taskSessionId;
      const status = resolveTaskStatusAfterRun(output, code ?? 1, controller.signal.aborted);

      const updated = opts.db.updateTask(taskId, {
        status,
        sessionId,
        result: output,
      });
      if (updated) {
        notifyTaskUpdate(opts, updated, true);
        if (status === "awaiting") {
          const sent = await maybeNotifyGate(updated, settings);
          if (sent) opts.db.updateTask(taskId, { gateNotifyHash: gateHash(output) });
        } else {
          await maybeNotifyTaskUpdate(updated, settings);
        }
        await maybeReleaseTaskWorkspace(opts, updated, status);
        await emitTaskComplete(updated);
      }
    });

    return opts.db.getTask(taskId)!;
  } catch (err) {
    running.delete(taskId);
    console.error(`[agent-desk] task ${taskId} start failed:`, errMessage(err));
    return markTaskFailed(opts, taskId, err);
  }
}

/** Fire-and-forget start that never surfaces as an unhandled rejection. */
export function enqueueStartTask(opts: RunnerOptions, taskId: string): void {
  void startTask(opts, taskId).catch((err) => {
    console.error(`[agent-desk] enqueueStartTask ${taskId}:`, errMessage(err));
  });
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
  resumeOpts?: { model?: string },
): Promise<Task> {
  const task = opts.db.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  if (isAbortReply(reply)) {
    stopTask(taskId, "abort_reply");
    const updated = opts.db.updateTask(taskId, {
      status: "stopped",
      result: `${task.result}\n\n[user abort: ${reply}]`,
    });
    if (updated) {
      await maybeReleaseTaskWorkspace(opts, updated, "stopped");
      await emitTaskComplete(updated);
    }
    return updated!;
  }

  const prompt = reply.trim() === "继续" || reply.trim().toLowerCase() === "continue"
    ? "Continue from where we left off."
    : reply;

  let nextPrompt = clipPrompt(`${task.prompt}\n\n---\nUser reply:\n${prompt}`);
  if (isDangerousCommandApproval(prompt)) {
    const pending = extractPendingDangerousCommand(task.result);
    if (pending) {
      nextPrompt = appendDangerousCommandApproval(nextPrompt, pending.command);
    }
  }

  const patch: Partial<Task> = {
    status: "created",
    prompt: nextPrompt,
    result: `${task.result || ""}\n\n## user\n${prompt}\n`,
  };
  if (resumeOpts && "model" in resumeOpts) {
    patch.model = resumeOpts.model ?? "";
  }
  opts.db.updateTask(taskId, patch);

  return startTask(opts, taskId);
}

export function isTaskRunning(taskId: string): boolean {
  return running.has(taskId);
}
