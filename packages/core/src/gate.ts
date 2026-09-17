import type { GateChoice, ParsedGate, TaskStatus } from "./types.js";
import { LEGACY_TASK_END_MARKER, PREFERRED_TASK_END_MARKER } from "./task-protocol.js";

const GATE_HEADING_RE = /(?:##\s*|【)闸门[「"']([^」"']+)[」"']/g;
const CLOSED_GATE_STATUS_RE = /已(确认|通过|收口|记录)/;
const OH_CHOICES_MARKER = "## oh-choices";
const LEGACY_HB_CHOICES_MARKER = "## hb-choices";
const CHOICES_MARKERS = [OH_CHOICES_MARKER, LEGACY_HB_CHOICES_MARKER];
const TASK_END_MARKERS = [PREFERRED_TASK_END_MARKER, LEGACY_TASK_END_MARKER];
/** Prefer line-anchored match; fall back to substring (hb-cli compatible). */
const TASK_END_LINE_RE = /^\s*##\s*(?:oh|hb)-task-end\s*$/im;

const NOT_QUESTION_HINTS = [
  "等待编排器",
  "本步完成",
  "已收口",
  "流程就此终止",
  "不进入后续步骤",
];

const TASK_DONE_HINTS = [
  "任务结束",
  "本步完成",
  "已收口",
  "流程就此终止",
  "不进入后续步骤",
  "集成验证已通过",
];

const USER_ABORT_HINTS = [
  "已按「先不修」",
  "收到「先不修」",
  "用户选择：**先不修**",
  "流程就此终止",
  "流程不再推进",
];

const LOG_LINE_TS_RE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?\] /;

export function isAbortReply(reply: string, abortValues = ["skip", "cancel", "先不修", "暂不修"]): boolean {
  const text = reply.trim();
  if (!text) return false;
  const compact = text.replace(/\s+/g, "");
  if (abortValues.includes(text)) return true;
  if (abortValues.some((v) => compact === v.replace(/\s+/g, ""))) return true;
  return compact.startsWith("先不修");
}

export function looksLikeUserAbort(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  return USER_ABORT_HINTS.some((h) => body.includes(h));
}

export function extractGateName(text: string): string {
  const m = text.match(/## 闸门[「"']([^」"']+)[」"']/);
  if (m) return m[1].trim();
  const m2 = text.match(/【闸门[「"']([^」"']+)[」"']/);
  if (m2) return m2[1].trim();
  return "";
}

function choicesMarkerIndex(body: string): number {
  let idx = -1;
  for (const marker of CHOICES_MARKERS) {
    const at = body.indexOf(marker);
    if (at >= 0 && (idx < 0 || at < idx)) idx = at;
  }
  return idx;
}

function hasChoicesMarker(body: string): boolean {
  return choicesMarkerIndex(body) >= 0;
}

export function containsOpenGate(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  const headings = [...body.matchAll(GATE_HEADING_RE)].map((m) => m[0]);
  if (headings.length === 0) return hasChoicesMarker(body);
  const hasOpen = headings.some((h) => !CLOSED_GATE_STATUS_RE.test(h));
  return hasOpen || hasChoicesMarker(body);
}

function stripJsonLogLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const bare = line.replace(LOG_LINE_TS_RE, "").trim();
      return !(bare.startsWith("{") && bare.endsWith("}"));
    })
    .join("\n");
}

/** Last agent invocation block (after the final `$ claude` command line). */
export function extractLastRunSegment(output: string): string {
  const marker = "$ claude";
  let last = -1;
  let pos = output.indexOf(marker);
  while (pos >= 0) {
    last = pos;
    pos = output.indexOf(marker, pos + marker.length);
  }
  return last >= 0 ? output.slice(last) : output;
}

export interface StreamJsonResult {
  subtype: string;
  isError: boolean;
  result: string;
}

export function parseLastStreamJsonResult(segment: string): StreamJsonResult | null {
  const lines = segment.split("\n");
  let last: StreamJsonResult | null = null;
  for (const line of lines) {
    const bare = line.replace(LOG_LINE_TS_RE, "").trim();
    if (!bare.startsWith("{") || !bare.endsWith("}")) continue;
    try {
      const evt = JSON.parse(bare) as {
        type?: string;
        subtype?: string;
        is_error?: boolean;
        result?: unknown;
      };
      if (evt.type !== "result") continue;
      last = {
        subtype: String(evt.subtype || ""),
        isError: evt.is_error === true,
        result: evt.result == null ? "" : String(evt.result),
      };
    } catch {
      /* ignore malformed json line */
    }
  }
  return last;
}

function resultHasAskUserQuestionDenial(segment: string): boolean {
  const lines = segment.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const bare = lines[i].replace(LOG_LINE_TS_RE, "").trim();
    if (!bare.startsWith("{")) continue;
    try {
      const evt = JSON.parse(bare) as {
        type?: string;
        permission_denials?: Array<{ tool_name?: string }>;
      };
      if (evt.type !== "result") continue;
      return (evt.permission_denials || []).some((d) => d.tool_name === "AskUserQuestion");
    } catch {
      /* ignore malformed json line */
    }
  }
  return false;
}

function hasDeniedAskUserQuestion(segment: string, fullOutput?: string): boolean {
  const scope = fullOutput || segment;
  if (!scope.includes("AskUserQuestion")) return false;
  const askIdx = scope.lastIndexOf("AskUserQuestion");
  const userIdx = scope.lastIndexOf("## user");
  if (userIdx > askIdx) return false;
  if (resultHasAskUserQuestionDenial(segment)) return true;
  return segment.includes("Answer questions?");
}

export function looksLikeQuestion(text: string): boolean {
  const segment = extractLastRunSegment(text);
  if (!segment.trim()) return false;
  if (looksLikeUserAbort(segment)) return false;
  if (containsOpenGate(segment)) return true;

  const lastResult = parseLastStreamJsonResult(segment);
  if (lastResult?.subtype === "success" && !lastResult.isError) {
    if (TASK_DONE_HINTS.some((h) => lastResult.result.includes(h))) return false;
    if (hasDeniedAskUserQuestion(segment, text)) return true;
    return false;
  }

  if (hasDeniedAskUserQuestion(segment, text)) return true;

  const plain = stripJsonLogLines(segment);
  if (NOT_QUESTION_HINTS.some((h) => plain.includes(h))) return false;
  return /请确认|是否|请选择|等待您|等待你/.test(plain);
}

export function containsTaskEndMarker(text: string): boolean {
  const body = text || "";
  if (!body.trim()) return false;
  if (TASK_END_LINE_RE.test(body)) return true;
  const lower = body.toLowerCase();
  return TASK_END_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

export type TaskStatusReason =
  | "aborted"
  | "user_abort"
  | "exit_nonzero"
  | "task_end"
  | "open_gate"
  | "question"
  | "plain_done";

export type TaskStatusResolution = {
  status: TaskStatus;
  reason: TaskStatusReason;
};

export function resolveTaskStatusAfterRun(
  output: string,
  exitCode: number,
  aborted: boolean,
): TaskStatusResolution {
  if (aborted) return { status: "stopped", reason: "aborted" };
  if (looksLikeUserAbort(output)) return { status: "stopped", reason: "user_abort" };
  if (exitCode !== 0) return { status: "failed", reason: "exit_nonzero" };

  const segment = extractLastRunSegment(output);
  // Explicit end marker wins over open-gate / question heuristics (A0/A1).
  if (containsTaskEndMarker(segment) || containsTaskEndMarker(output)) {
    return { status: "done", reason: "task_end" };
  }
  if (containsOpenGate(segment)) return { status: "awaiting", reason: "open_gate" };
  if (looksLikeQuestion(output)) return { status: "awaiting", reason: "question" };
  return { status: "done", reason: "plain_done" };
}

/** Human-readable status log line for the task result. */
export function formatStatusReasonLog(resolution: TaskStatusResolution): string {
  switch (resolution.reason) {
    case "task_end":
      return `\n[done] 检测到 ${PREFERRED_TASK_END_MARKER}，任务已收口。\n`;
    case "open_gate":
      return `\n[awaiting] 检测到未关闭闸门，等待确认。\n`;
    case "question":
      return `\n[awaiting] 检测到待确认提问。\n`;
    case "plain_done":
      return `\n[done] 本轮结束（无闸门）。\n`;
    case "user_abort":
      return `\n[stopped] 用户放弃修复，任务已终止。\n`;
    case "aborted":
      return `\n[stopped] 任务已中止。\n`;
    case "exit_nonzero":
      return `\n[failed] 进程异常退出。\n`;
    default:
      return "";
  }
}

export function parseOhChoices(text: string): GateChoice[] {
  const body = text.trim();
  const idx = choicesMarkerIndex(body);
  if (idx < 0) return [];
  const marker =
    body.slice(idx, idx + OH_CHOICES_MARKER.length) === OH_CHOICES_MARKER
      ? OH_CHOICES_MARKER
      : LEGACY_HB_CHOICES_MARKER;
  const section = body.slice(idx + marker.length);
  const choices: GateChoice[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const raw = trimmed.slice(1).trim();
    const sep = raw.includes("|") ? "|" : raw.includes("｜") ? "｜" : null;
    if (sep) {
      const [label, value] = raw.split(sep).map((s) => s.trim());
      if (label && value) choices.push({ label, value });
    } else if (raw) {
      choices.push({ label: raw, value: raw });
    }
  }
  return choices;
}

/** @deprecated Use parseOhChoices */
export const parseHbChoices = parseOhChoices;

export function parseGate(text: string): ParsedGate | null {
  if (!containsOpenGate(text)) return null;
  const name = extractGateName(text);
  const heading = name ? `闸门「${name}」` : "闸门";
  return {
    name,
    heading,
    choices: parseOhChoices(text),
  };
}

export function extractUserRepliesFromPrompt(prompt: string): string[] {
  const parts = String(prompt || "").split(/\n---\nUser reply:\n/);
  if (parts.length <= 1) return [];
  return parts
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Body to pass to the agent CLI on resume (session already holds prior context). */
export function agentPromptBodyForRun(prompt: string, hasSession: boolean): string {
  if (!hasSession) return prompt;
  const replies = extractUserRepliesFromPrompt(prompt);
  if (!replies.length) return prompt.trim();
  return replies[replies.length - 1];
}

export function clipTitle(title: string, fallback = "", maxLen = 80): string {
  const text = (title || "").trim() || (fallback || "").trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

export function clipPrompt(prompt: string, maxLen = 8000): string {
  if (prompt.length <= maxLen) return prompt;
  return prompt.slice(0, maxLen);
}

export function newTaskId(): string {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function newWorkflowRunId(): string {
  return `wr_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function newWorkItemId(): string {
  return `wi_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function newWorkItemEventId(): string {
  return `we_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function newAutopilotId(): string {
  return `ap_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function newAutopilotRunId(): string {
  return `ar_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

/** Public webhook path token (URL credential). */
export function newAutopilotWebhookToken(): string {
  return `awt_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2, 10)}`;
}

/** HMAC signing secret for X-Hub-Signature-256. */
export function newAutopilotWebhookSecret(): string {
  return `aws_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2, 14)}`;
}

export function newProjectId(): string {
  return `p_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

/** Normalize issue codes for lookup (#42 and 42 match). */
export function normalizeIssueCode(code: string): string {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "");
}
