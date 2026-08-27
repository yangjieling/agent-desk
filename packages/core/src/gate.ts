import type { GateChoice, ParsedGate } from "./types.js";

const GATE_HEADING_RE = /(?:##\s*|【)闸门[「"']([^」"']+)[」"']/g;
const CLOSED_GATE_STATUS_RE = /已(确认|通过|收口|记录)/;
const HB_CHOICES_MARKER = "## hb-choices";

const NOT_QUESTION_HINTS = [
  "等待编排器",
  "本步完成",
  "已收口",
  "流程就此终止",
  "不进入后续步骤",
];

const USER_ABORT_HINTS = [
  "已按「先不修」",
  "收到「先不修」",
  "用户选择：**先不修**",
  "流程就此终止",
  "流程不再推进",
];

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

export function containsOpenGate(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  const headings = [...body.matchAll(GATE_HEADING_RE)].map((m) => m[0]);
  if (headings.length === 0) return body.includes(HB_CHOICES_MARKER);
  const hasOpen = headings.some((h) => !CLOSED_GATE_STATUS_RE.test(h));
  return hasOpen || body.includes(HB_CHOICES_MARKER);
}

export function looksLikeQuestion(text: string): boolean {
  if (!text.trim()) return false;
  if (looksLikeUserAbort(text)) return false;
  if (containsOpenGate(text)) return true;
  if (NOT_QUESTION_HINTS.some((h) => text.includes(h))) return false;
  return /[?？]|请确认|是否|请选择|等待您|等待你/.test(text);
}

export function parseHbChoices(text: string): GateChoice[] {
  const body = text.trim();
  const idx = body.indexOf(HB_CHOICES_MARKER);
  if (idx < 0) return [];
  const section = body.slice(idx + HB_CHOICES_MARKER.length);
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

export function parseGate(text: string): ParsedGate | null {
  if (!containsOpenGate(text)) return null;
  const name = extractGateName(text);
  const heading = name ? `闸门「${name}」` : "闸门";
  return {
    name,
    heading,
    choices: parseHbChoices(text),
  };
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
