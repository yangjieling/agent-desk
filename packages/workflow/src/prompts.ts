import type { WorkflowNode, WorkflowRunNode } from "@agent-desk/core";

function stepBoundaryRules(skill: string, index: number, nodes: WorkflowRunNode[]): string {
  const prev = nodes.slice(0, index).map((n) => n.skill).filter(Boolean);
  const next = nodes.slice(index + 1).map((n) => n.skill).filter(Boolean);
  const parts = [`当前步骤技能: ${skill}`];
  if (prev.length) parts.push(`已完成步骤: ${prev.join(" → ")}`);
  if (next.length) parts.push(`后续步骤: ${next.join(" → ")}（由编排器自动推进，本步勿代劳）`);
  return parts.join("\n");
}

export function buildSharedFirstPrompt(
  workflowName: string,
  node: WorkflowNode,
  index: number,
  total: number,
  sharedContext: string,
  inputPrompt: string,
  allNodes: WorkflowRunNode[],
): string {
  const skill = node.skill;
  const parts = [
    `【流程编排 · 共享模式】流程「${workflowName}」第 ${index + 1}/${total} 步`,
    `本步技能: ${skill}`,
    "共享模式全程使用同一会话推进；本步只做当前 skill，完成后由编排器自动进入下一步。",
    stepBoundaryRules(skill, index, allNodes),
  ];
  if (inputPrompt.trim()) parts.push(`【流程输入】\n${inputPrompt.trim()}`);
  if (sharedContext.trim()) parts.push(`【前序步骤上下文】\n${sharedContext.trim()}`);
  const body = node.prompt.trim() || `执行 ${skill} 技能。`;
  parts.push(`【本步任务】\n${body}`);
  if (node.requireGate) {
    parts.push(
      "【强制闸门】本步结束前必须输出 ## 闸门「确认」 与 ## hb-choices（至少含「确认继续」与「先不修」），等待用户确认后再结束本步。",
    );
  } else {
    parts.push(
      "若需用户确认，请输出 ## 闸门「名称」 与 ## hb-choices 列表；用户选「先不修/skip」将终止整个流程。",
    );
  }
  return parts.join("\n\n");
}

export function buildSharedContinuePrompt(
  workflowName: string,
  node: WorkflowNode,
  index: number,
  total: number,
  allNodes: WorkflowRunNode[],
): string {
  const skill = node.skill;
  const body = node.prompt.trim() || `执行 ${skill} 技能。`;
  const parts = [
    `【编排器已推进 — 请立即执行第 ${index + 1}/${total} 步】`,
    `流程「${workflowName}」编排器已在同一会话内进入本步。`,
    `请立即完成下列任务；禁止重复前序步骤或只写「等待编排器」而不执行。`,
    stepBoundaryRules(skill, index, allNodes),
    `【本步任务】\n${body}`,
  ];
  if (node.requireGate) {
    parts.push(
      "【强制闸门】本步结束前必须输出 ## 闸门「确认」 与 ## hb-choices（至少含「确认继续」与「先不修」）。",
    );
  }
  return parts.join("\n\n");
}

export function buildIndependentPrompt(node: WorkflowNode, inputPrompt: string): string {
  const parts = ["【流程编排 · 独立模式】本步骤与其他步骤无上下文共享；全部成功才算流程完成。"];
  if (inputPrompt.trim()) parts.push(`【流程输入】\n${inputPrompt.trim()}`);
  const body = node.prompt.trim() || `执行 ${node.skill} 技能。`;
  parts.push(`【本步任务】\n${body}`);
  if (node.requireGate) {
    parts.push(
      "【强制闸门】本步结束前必须输出 ## 闸门「确认」 与 ## hb-choices，等待用户确认。",
    );
  }
  return parts.join("\n\n");
}

export function appendSharedContext(
  ctx: string,
  node: WorkflowRunNode,
  result: string,
): string {
  const chunk = `\n### ${node.title || node.skill} (${node.skill})\n${result.trim()}\n`;
  return (ctx + chunk).trim();
}
