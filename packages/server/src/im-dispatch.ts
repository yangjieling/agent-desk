import { clipPrompt, clipTitle } from "@agent-desk/core";
import type { Settings } from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import { createTask, enqueueStartTask, type RunnerOptions } from "@agent-desk/runner";

export type ImInboundMessage = {
  provider: "feishu" | "dingtalk";
  text: string;
  senderName: string;
  chatId?: string;
  messageId?: string;
  meta?: Record<string, unknown>;
};

/**
 * Create + enqueue a skill task from an IM message (Autopilot-style control plane).
 */
export function dispatchImInboundMessage(
  db: AgentDeskDb,
  runnerOpts: RunnerOptions,
  settings: Settings,
  msg: ImInboundMessage,
): { taskId: string; title: string } {
  const feishu = settings.feishu || {};
  const agentProfileId =
    String(feishu.inboundAgentProfileId || "").trim() ||
    String(settings.defaultAgentId || "").trim() ||
    undefined;
  const agent = agentProfileId ? db.getAgent(agentProfileId) : null;
  const skill =
    String(feishu.inboundSkill || "").trim() ||
    agent?.defaultSkill ||
    "default";
  const projectDir =
    String(feishu.inboundProjectDir || "").trim() || process.cwd();

  const stamp = new Date().toISOString().slice(11, 19);
  const title = clipTitle(`IM · ${msg.provider} · ${msg.senderName || "user"} · ${stamp}`);
  const metaLines = [
    `来源: ${msg.provider}`,
    msg.senderName ? `发送者: ${msg.senderName}` : "",
    msg.chatId ? `会话: ${msg.chatId}` : "",
    msg.messageId ? `消息: ${msg.messageId}` : "",
  ].filter(Boolean);
  const prompt = clipPrompt(
    [
      "【IM 入站消息】",
      ...metaLines,
      "",
      "请根据下列用户消息执行任务；需要确认时使用 ## 闸门「名称」 与 ## oh-choices。",
      "",
      msg.text.trim(),
    ].join("\n"),
  );

  const task = createTask(
    {
      title,
      prompt,
      projectDir,
      skill,
      agentProfileId,
    },
    settings,
    runnerOpts,
  );
  db.upsertTask(task);
  enqueueStartTask(runnerOpts, task.id);
  return { taskId: task.id, title: task.title };
}
