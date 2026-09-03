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
  prependAgentInstructions,
  resolveAgentConfig,
  resolveTaskStatusAfterRun,
  type Settings,
  type Task,
  type TaskFailureCode,
} from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import { getAgentBackend } from "@agent-desk/provider-agent";
import {
  ensureIssueWorkspace,
  maybeReleaseAutoWorkspace,
  restoreManagedAutoWorkspaceIfMissing,
} from "@agent-desk/provider-issue-github";
import { getNotifyProvider } from "@agent-desk/provider-notify";
import { mountSkill } from "@agent-desk/skills";
import {
  createLogLinePrefixer,
  formatActivityLogLine,
  formatCommandLogLine,
  formatLogTimestamp,
  agentStartupLabel,
} from "./log-format.js";
import { publishTaskUpdate } from "./task-events.js";
import {
  clearRetryTimer,
  failureCodeFromError,
  maybeScheduleAutoRetry,
  processWorkspaceQueue,
} from "./queue.js";

export { bootstrapTaskQueue } from "./queue.js";
export { processWorkspaceQueue } from "./queue.js";
export { reclaimOrphanActiveTasks, startTaskWatchdog, stopTaskWatchdog } from "./queue.js";
export { subscribeTaskUpdates, type TaskStreamUpdate } from "./task-events.js";

export interface CreateTaskInput {
  title: string;
  prompt: string;
  projectDir?: string;
  workItemId?: string;
  issueCode?: string;
  skill?: string;
  agentProfileId?: string;
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
const lastPublishedResultLen = new Map<string, number>();

function publishTaskSnapshot(task: Task): void {
  const result = task.result ?? "";
  const prev = lastPublishedResultLen.get(task.id) ?? 0;
  const resultAppend = result.length > prev ? result.slice(prev) : undefined;
  lastPublishedResultLen.set(task.id, result.length);
  publishTaskUpdate({ task, resultAppend });
}

function resetPublishedResultLen(taskId: string, len = 0): void {
  lastPublishedResultLen.set(taskId, len);
}

function notifyTaskUpdate(opts: RunnerOptions, taskOrId: string | Task, immediate = false): void {
  const emit = () => {
    const task = typeof taskOrId === "string" ? opts.db.getTask(taskOrId) : taskOrId;
    if (task) publishTaskSnapshot(task);
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

export function resolveTaskAgent(
  opts: RunnerOptions,
  settings: Settings,
  input: {
    agentProfileId?: string;
    codingAgent?: string;
    model?: string;
    skill?: string;
  },
) {
  const profileId = (input.agentProfileId || settings.defaultAgentId || "").trim();
  const profile = profileId ? opts.db.getAgent(profileId) : null;
  return resolveAgentConfig(profile, settings, input);
}

export function createTask(input: CreateTaskInput, settings: Settings, opts?: RunnerOptions): Task {
  const resolved = opts
    ? resolveTaskAgent(opts, settings, input)
    : resolveAgentConfig(null, settings, input);
  const now = Date.now();
  let workItemId = "";
  let issueCode = input.issueCode ?? "";
  if (opts) {
    const workItem = opts.db.resolveOrCreateWorkItem(
      {
        workItemId: input.workItemId,
        issueCode: input.issueCode,
        title: input.title,
        projectDir: input.projectDir,
        agentProfileId: resolved.agentProfileId,
      },
      settings,
    );
    if (workItem) {
      workItemId = workItem.id;
      if (!issueCode && workItem.issueCode) issueCode = workItem.issueCode;
      opts.db.touchWorkItem(workItem.id, { status: "in_progress" });
    }
  }
  const task: Task = {
    id: newTaskId(),
    taskType: "skill",
    status: "created",
    skill: input.skill ?? resolved.defaultSkill,
    workflowId: "",
    workflowRunId: "",
    workflowName: "",
    workflowMode: "",
    workflowStep: 0,
    workflowStepTotal: 0,
    parentTaskId: "",
    workflowNodeIndex: null,
    projectDir: input.projectDir ?? process.cwd(),
    workItemId,
    issueCode,
    title: clipTitle(input.title),
    prompt: clipPrompt(input.prompt),
    agentProfileId: resolved.agentProfileId,
    codingAgent: resolved.codingAgent,
    model: resolved.model,
    sessionId: "",
    result: "",
    gateNotifyHash: "",
    retryCount: 0,
    failureCode: "",
    failureMessage: "",
    nextRetryAt: 0,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  };
  if (opts && workItemId) {
    opts.db.addWorkItemEvent({
      workItemId,
      kind: "run_linked",
      author: "system",
      body: `发起执行：${task.title}`,
      taskId: task.id,
      createdAt: now,
    });
  }
  return task;
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

async function markTaskQueued(
  opts: RunnerOptions,
  taskId: string,
  code: TaskFailureCode,
  message: string,
): Promise<Task> {
  const prev = opts.db.getTask(taskId);
  const stamp = `\n\n${formatLogTimestamp()} [queued] ${message}`;
  const result = prev?.result?.trim()
    ? `${prev.result.trim()}${stamp}`
    : `${formatLogTimestamp()} [queued] ${message}`;
  const updated = opts.db.updateTask(taskId, {
    status: "queued",
    failureCode: code,
    failureMessage: message,
    nextRetryAt: 0,
    result,
    lastActivityAt: Date.now(),
  });
  const task = updated ?? prev;
  if (task) {
    resetPublishedResultLen(task.id, (task.result ?? "").length);
    publishTaskUpdate({ task, resultAppend: undefined });
  }
  if (!task) throw new Error(`Task not found after queue: ${taskId}`);
  return task;
}

async function markTaskFailed(
  opts: RunnerOptions,
  taskId: string,
  err: unknown,
  code: TaskFailureCode = "start_error",
): Promise<Task> {
  const prev = opts.db.getTask(taskId);
  const msg = errMessage(err);
  const stamp = `\n\n${formatLogTimestamp()} [start error] ${msg}`;
  const result = prev?.result?.trim()
    ? `${prev.result.trim()}${stamp}`
    : `${formatLogTimestamp()} [start error] ${msg}`;
  const updated = opts.db.updateTask(taskId, {
    status: "failed",
    failureCode: code,
    failureMessage: msg,
    nextRetryAt: 0,
    result,
    lastActivityAt: Date.now(),
  });
  const task = updated ?? prev;
  if (task) {
    resetPublishedResultLen(task.id, (task.result ?? "").length);
    publishTaskUpdate({ task, resultAppend: undefined });
    const retried = await maybeScheduleAutoRetry(opts, task, startTask);
    if (retried.status === "failed") {
      await maybeNotifyTaskUpdate(retried, resolveSettings(opts));
    }
    await emitTaskComplete(retried);
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
  if (!opts.dataDir) return task;

  let current = task;
  const projectDir = (current.projectDir || "").trim();
  const resolved = projectDir ? path.resolve(projectDir) : "";

  // Auto-clone dirs may have been released after a prior done/failed/stopped run.
  // On start/retry, restore missing managed paths under workspaces/auto/<owner>/<repo>.
  if (resolved && !fs.existsSync(resolved)) {
    try {
      const restored = await restoreManagedAutoWorkspaceIfMissing(opts.dataDir, resolved);
      if (restored) {
        const stamp = `\n\n${formatActivityLogLine(
          "workspace",
          `已重新 clone ${restored.owner}/${restored.repo} → ${restored.projectDir}`,
          "done",
        ).trimEnd()}`;
        const patch: Partial<Task> = {
          projectDir: restored.projectDir,
          result: current.result?.trim() ? `${current.result.trim()}${stamp}` : stamp.trimStart(),
          lastActivityAt: Date.now(),
        };
        current = opts.db.updateTask(current.id, patch) ?? { ...current, ...patch };
        notifyTaskUpdate(opts, current, true);
      }
    } catch (err) {
      console.error(
        `[agent-desk] restore auto workspace failed for ${resolved}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Issue-linked GitHub tasks: ensure checkout matches configured repo (may also clone).
  if (current.issueCode?.trim() && resolveSettings(opts).providers.issue === "github") {
    try {
      const ws = await ensureIssueWorkspace(opts.dataDir);
      if (current.projectDir !== ws.projectDir) {
        const updated = opts.db.updateTask(current.id, { projectDir: ws.projectDir });
        current = updated ?? current;
      }
    } catch (err) {
      console.error(
        `[agent-desk] ensureIssueWorkspace failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return current;
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
    const cwd = task.projectDir || process.cwd();

    if (!fs.existsSync(cwd)) {
      return markTaskFailed(
        opts,
        taskId,
        new Error(
          `工作目录不存在：${cwd}。若为自动 clone 的仓库，请检查 GitHub Token/网络后重试；本地目录请重新选择工作区。`,
        ),
        "start_error",
      );
    }

    if (settings.workspaceLockEnabled !== false) {
      const busy = opts.db.countActiveTasksForProjectDir(cwd, taskId);
      if (busy > 0) {
        if (settings.queueWhenWorkspaceBusy !== false) {
          return markTaskQueued(
            opts,
            taskId,
            "workspace_busy",
            `工作区正被其他任务占用，已加入队列：${cwd}`,
          );
        }
        return markTaskFailed(
          opts,
          taskId,
          new Error(`工作区正被其他任务占用：${cwd}。请等待完成或停止后再试。`),
          "workspace_busy",
        );
      }
    }

    const backend = getAgentBackend(task.codingAgent || settings.codingAgent);
    await backend.requireReady();

    const controller = new AbortController();
    running.set(taskId, controller);

    const skillMount = mountSkill(task.skill || "default", { cwd });
    const runPrompt = agentPromptBodyForRun(task.prompt, Boolean(task.sessionId));
    let promptBody = task.sessionId
      ? runPrompt
      : skillMount.promptPrefix
        ? `${skillMount.promptPrefix}\n${task.prompt}`
        : task.prompt;
    if (!task.sessionId && task.agentProfileId) {
      const profile = opts.db.getAgent(task.agentProfileId);
      promptBody = prependAgentInstructions(promptBody, profile?.instructions || "");
    }
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

    const agentLabel = agentStartupLabel(backend.displayName || backend.id || task.codingAgent || "");
    let output = task.result ? `${task.result}\n` : "";
    output += formatActivityLogLine("runtime", `${agentLabel} 运行时已就绪`, "done");
    output += formatActivityLogLine(
      "prompt",
      task.sessionId ? "已准备续跑输入" : "已写入 prompt",
      "done",
    );
    output += formatActivityLogLine(
      "cli",
      task.sessionId ? `续跑 ${agentLabel}…` : `启动 ${agentLabel}…`,
      "running",
    );
    output += formatCommandLogLine(args);

    const runningTask = opts.db.updateTask(taskId, {
      status: "running",
      failureCode: "",
      failureMessage: "",
      nextRetryAt: 0,
      result: output,
      lastActivityAt: Date.now(),
    });
    resetPublishedResultLen(taskId, output.length);
    notifyTaskUpdate(opts, runningTask ?? taskId, true);

    const child = spawn(args[0], args.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: controller.signal,
      env: process.env,
    });

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
      void markTaskFailed(opts, taskId, err, failureCodeFromError(err));
    });

    child.on("close", async (code) => {
      if (settled) return;
      settled = true;
      running.delete(taskId);
      const tail = linePrefixer.flush();
      if (tail) output += tail;
      const sessionId = backend.extractSessionId(events) ?? taskSessionId;
      const abortReason = controller.signal.aborted
        ? String(controller.signal.reason ?? "aborted")
        : "";
      const idleAbort = abortReason === "idle_timeout";
      const status = resolveTaskStatusAfterRun(output, code ?? 1, controller.signal.aborted);

      const patch: Partial<Task> = {
        status,
        sessionId,
        result: output,
      };
      if (idleAbort) {
        patch.status = "failed";
        patch.failureCode = "idle_timeout";
        patch.failureMessage = "空闲超时：长时间无输出，已自动中止";
        patch.nextRetryAt = 0;
        patch.result = `${output}\n\n${formatLogTimestamp()} [idle] ${patch.failureMessage}`;
      } else if (status === "failed") {
        patch.failureCode = "exit_nonzero";
        patch.failureMessage = `进程退出码 ${code ?? 1}`;
        patch.nextRetryAt = 0;
      }

      const updated = opts.db.updateTask(taskId, patch);
      if (updated) {
        notifyTaskUpdate(opts, updated, true);
        if (updated.status === "awaiting") {
          const sent = await maybeNotifyGate(updated, settings);
          if (sent) opts.db.updateTask(taskId, { gateNotifyHash: gateHash(output) });
        } else if (updated.status === "failed") {
          const retried = await maybeScheduleAutoRetry(opts, updated, startTask);
          if (retried.status === "failed") {
            await maybeNotifyTaskUpdate(retried, settings);
          }
          await maybeReleaseTaskWorkspace(opts, retried, retried.status);
          await emitTaskComplete(retried);
          await processWorkspaceQueue(opts, retried.projectDir, startTask);
          return;
        } else {
          await maybeNotifyTaskUpdate(updated, settings);
        }
        await maybeReleaseTaskWorkspace(opts, updated, updated.status);
        await emitTaskComplete(updated);
        await processWorkspaceQueue(opts, updated.projectDir, startTask);
      }
    });

    return opts.db.getTask(taskId)!;
  } catch (err) {
    running.delete(taskId);
    console.error(`[agent-desk] task ${taskId} start failed:`, errMessage(err));
    return markTaskFailed(opts, taskId, err, failureCodeFromError(err));
  }
}

/** Fire-and-forget start that never surfaces as an unhandled rejection. */
export function enqueueStartTask(opts: RunnerOptions, taskId: string): void {
  void startTask(opts, taskId).catch((err) => {
    console.error(`[agent-desk] enqueueStartTask ${taskId}:`, errMessage(err));
  });
}

export function stopTask(taskId: string, reason = "user_stop"): boolean {
  clearRetryTimer(taskId);
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

  const recordGateReply = (text: string, aborted: boolean) => {
    const workItemId = (task.workItemId || "").trim();
    if (!workItemId) return;
    // Only persist human gate decisions (and abort from awaiting), not plain "continue" resumes.
    if (task.status !== "awaiting" && !aborted) return;
    const gate = parseGate(task.result || "");
    const heading = gate?.heading || "闸门";
    const prefix = aborted ? "中止" : "确认";
    opts.db.addWorkItemEvent({
      workItemId,
      kind: "gate_reply",
      author: "user",
      body: `${prefix}「${heading}」：${text}`,
      taskId: task.id,
    });
  };

  if (isAbortReply(reply)) {
    recordGateReply(reply, true);
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

  recordGateReply(prompt, false);

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

/** Abort a live runner (watchdog idle timeout). Returns false if not owned here. */
export function abortRunningTask(taskId: string, reason = "idle_timeout"): boolean {
  const controller = running.get(taskId);
  if (!controller) return false;
  try {
    controller.abort(reason);
  } catch {
    /* ignore */
  }
  return true;
}
