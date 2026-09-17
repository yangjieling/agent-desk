/**
 * Host task-state protocol: structured markers the agent should emit,
 * and helpers to enrich resume prompts / synthesize host-owned gates.
 * See docs/task-state-control-design.md (Phase A).
 */

export const PREFERRED_TASK_END_MARKER = "## oh-task-end";
export const LEGACY_TASK_END_MARKER = "## hb-task-end";

/** Prompt block teaching the model when/how to emit the end marker. */
export function taskEndRules(): string {
  return (
    "\n\n---\n" +
    "【任务收口 — 固定标记,必须遵守】\n" +
    "当用户明确表示结束/不用了/先这样/结束本次任务/不需要继续等意图时:\n" +
    "1. **不要**再开任何新闸门(含服务评价、后续操作、项目简介确认)；\n" +
    "2. **不要**再输出 ## oh-choices / ## hb-choices；\n" +
    "3. 先输出一行独立标记(必须原样、单独成行):\n\n" +
    `${PREFERRED_TASK_END_MARKER}\n\n` +
    "4. 标记下方可写一两句简短致谢/告别,然后立即结束本轮。\n" +
    "5. 若用户刚完成服务评价(回复好/还可以/差),收尾时同样输出 " +
    `${PREFERRED_TASK_END_MARKER},勿再开闸门。\n` +
    "6. 「先不修」等放弃修复仍按既有终止语义处理;若同时收口,也请带上 " +
    `${PREFERRED_TASK_END_MARKER}。\n` +
    `（兼容旧标记 ${LEGACY_TASK_END_MARKER}。）\n`
  );
}

/** Stronger nudge when the user just chose end / rating. */
export function taskEndRulesEmphasis(kind: "end" | "rating"): string {
  if (kind === "rating") {
    return (
      "\n\n---\n" +
      "【收口提醒】用户刚完成服务评价。请输出一行独立标记 " +
      `${PREFERRED_TASK_END_MARKER}，不要再开闸门或 ## oh-choices。\n`
    );
  }
  return (
    "\n\n---\n" +
    "【收口提醒】用户已选择结束本次任务。请输出一行独立标记 " +
    `${PREFERRED_TASK_END_MARKER}，不要再开闸门或 ## oh-choices。\n`
  );
}

const END_REPLY_RE =
  /^(结束|先这样|不用了|不需要继续|结束本次|结束任务|end|done|finish|stop here)[.!！。]?$/i;
const RATING_REPLY_RE = /^(好|还可以|差|good|ok|okay|bad|poor)[.!！。]?$/i;

export function looksLikeTaskEndReply(reply: string): boolean {
  const text = String(reply || "").trim();
  if (!text) return false;
  if (END_REPLY_RE.test(text)) return true;
  const compact = text.replace(/\s+/g, "");
  return /^(结束|先这样|不用了)$/.test(compact);
}

export function looksLikeRatingReply(reply: string): boolean {
  const text = String(reply || "").trim();
  if (!text) return false;
  return RATING_REPLY_RE.test(text);
}

/**
 * Build the CLI body for a resume turn: user reply + protocol rules.
 * Stored task.prompt stays the raw reply chain; this only affects the spawn input.
 */
export function enrichResumePromptBody(reply: string): string {
  const base = String(reply || "").trim() || "Continue from where we left off.";
  let extra = taskEndRules();
  if (looksLikeTaskEndReply(base)) {
    extra += taskEndRulesEmphasis("end");
  } else if (looksLikeRatingReply(base)) {
    extra += taskEndRulesEmphasis("rating");
  }
  return `${base}${extra}`;
}

/** Host-owned service-rating gate (A2 free-task option B). */
export function synthesizeServiceRatingGate(): string {
  return [
    "",
    "## 闸门「服务评价」",
    "请评价本次任务体验。",
    "",
    "## oh-choices",
    "- 好|好",
    "- 还可以|还可以",
    "- 差|差",
    "",
  ].join("\n");
}

export function isFreeSkill(skill: string | undefined | null): boolean {
  const id = String(skill || "").trim().toLowerCase();
  return !id || id === "default";
}

/** Nudge text when strictTaskEndMarker holds done without a marker. */
export function strictTaskEndNudgePrompt(): string {
  return (
    "请先输出一行独立收口标记 " +
    `${PREFERRED_TASK_END_MARKER}，然后再结束本轮。不要开新闸门。`
  );
}
