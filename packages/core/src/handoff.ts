/** Mid-task executor handoff briefing (awaiting → new session). */

import type { Task } from "./types.js";
import { extractGateName } from "./gate.js";

export const HANDOFF_MAX_CHARS = 5000;

function clip(text: string, maxLen: number): string {
  const raw = (text || "").trim();
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1)}…`;
}

export function buildHandoffBriefing(input: {
  task: Task;
  fromLabel: string;
  toLabel: string;
  /** Optional structured Shared Context (workflow) injected into the briefing. */
  sharedContextText?: string;
  /** When set, mark this handoff as failure-driven failover. */
  failureReason?: string;
}): string {
  const { task, fromLabel, toLabel } = input;
  const openGate = extractGateName(task.result || "");
  const failureReason = String(input.failureReason || "").trim();
  const lines: string[] = [
    failureReason
      ? "你是失败换人后接手本任务的新执行者。上一 CLI 会话已失败且不可继续，" +
        "请仅依据下列交接说明与当前仓库事实推进，勿假设仍持有上一会话记忆。" +
        "忽略原文中「同一会话/同一 thread」表述——本轮已是新会话。"
      : "你是接力接手本任务的新执行者。上一 CLI 会话不可继续，" +
        "请仅依据下列交接说明与当前仓库事实推进，勿假设仍持有上一会话记忆。" +
        "忽略原文中「同一会话/同一 thread」表述——本轮已是新会话。",
    "",
    `- 上一任执行者：${(fromLabel || "未知").trim() || "未知"}`,
    `- 本任执行者：${(toLabel || "未知").trim() || "未知"}`,
  ];
  if (failureReason) {
    lines.push(`- 换人原因：${clip(failureReason, 400)}`);
  }
  const title = (task.title || "").trim();
  if (title) lines.push(`- 任务标题：${title}`);
  const skill = (task.skill || "").trim();
  if (skill) lines.push(`- 技能：${skill}`);
  const issue = (task.issueCode || "").trim();
  if (issue) lines.push(`- 关联编号：${issue}`);
  if (openGate) lines.push(`- 当前待确认闸门：「${openGate}」`);

  const prompt = clip(String(task.prompt || ""), 800);
  if (prompt) {
    lines.push("", "【原始目标】", prompt);
  }

  const shared = clip(String(input.sharedContextText || "").trim(), 1600);
  if (shared) {
    lines.push("", "【共享上下文】", shared);
  }

  const resultTail = clip(String(task.result || "").slice(-2000), 600);
  if (resultTail) {
    lines.push("", "【近期输出摘要】", resultTail);
  }

  lines.push(
    "",
    "【下一任行动】",
    "1. 若用户本轮回复是对未关闭闸门的确认：视为该闸门已通过；禁止再次打开同一闸门。",
    "2. 否则按交接说明推进下一动作（必要工具调用，或开下一闸门）。",
    "3. 本轮必须有实质输出；禁止空回复或仅客套话结束。",
    "4. 缺关键信息时向用户追问，不要推倒重来。",
  );
  if (openGate) {
    lines.splice(
      lines.length - 4,
      0,
      `   （当前待确认闸门为「${openGate}」。）`,
    );
  }

  return clip(lines.join("\n"), HANDOFF_MAX_CHARS);
}

export function prependHandoffBriefing(promptBody: string, briefing: string): string {
  const b = (briefing || "").trim();
  if (!b) return promptBody;
  return `${b}\n\n---\n${promptBody}`;
}
