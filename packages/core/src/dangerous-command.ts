import { createHash } from "node:crypto";

export const DANGEROUS_CMD_PENDING_MARKER = "## dangerous-cmd-pending";
export const DANGEROUS_CMD_APPROVE_REPLY = "允许执行";
export const DANGEROUS_CMD_DENY_REPLY = "拒绝执行";

export interface DangerousCommandMatch {
  command: string;
  category: string;
  summary: string;
}

const RULES: Array<{ category: string; summary: string; re: RegExp }> = [
  { category: "issue", summary: "关闭 GitHub Issue", re: /\bgh\s+issue\s+close\b/i },
  { category: "issue", summary: "删除 GitHub Issue", re: /\bgh\s+issue\s+delete\b/i },
  { category: "issue", summary: "重新打开 GitHub Issue", re: /\bgh\s+issue\s+reopen\b/i },
  { category: "pr", summary: "合并 Pull Request", re: /\bgh\s+pr\s+merge\b/i },
  { category: "repo", summary: "删除 GitHub 仓库", re: /\bgh\s+repo\s+delete\b/i },
  { category: "git", summary: "推送到远程仓库", re: /\bgit\s+push\b/i },
  { category: "git", summary: "硬重置 Git 分支", re: /\bgit\s+reset\b[^\n]*--hard\b/i },
  { category: "git", summary: "强制清理未跟踪文件", re: /\bgit\s+clean\b[^\n]*(-f|--force)/i },
  { category: "fs", summary: "删除文件或目录", re: /\brm\s+(-[^\s]*f[^\s]*r|-[^\s]*r[^\s]*f|--recursive|--force)/i },
  { category: "k8s", summary: "删除 Kubernetes 资源", re: /\bkubectl\s+delete\b/i },
];

export function normalizeDangerousCommand(command: string): string {
  return String(command || "").replace(/\s+/g, " ").trim();
}

export function dangerousCommandId(command: string): string {
  const norm = normalizeDangerousCommand(command);
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function matchDangerousCommand(command: string): DangerousCommandMatch | null {
  const cmd = normalizeDangerousCommand(command);
  if (!cmd) return null;
  for (const rule of RULES) {
    if (rule.re.test(cmd)) {
      return { command: cmd, category: rule.category, summary: rule.summary };
    }
  }
  return null;
}

export function formatDangerousCommandGate(match: DangerousCommandMatch): string {
  const cmd = match.command.trim();
  return [
    "## 闸门「危险命令确认」待确认",
    "",
    `Agent 请求执行：**${match.summary}**`,
    "",
    "以下命令需经你确认后才会继续：",
    "",
    "```",
    cmd,
    "```",
    "",
    DANGEROUS_CMD_PENDING_MARKER,
    cmd,
    "",
    "## oh-choices",
    `- 允许执行 | ${DANGEROUS_CMD_APPROVE_REPLY}`,
    `- 拒绝执行 | ${DANGEROUS_CMD_DENY_REPLY}`,
  ].join("\n");
}

export function extractPendingDangerousCommand(text: string): DangerousCommandMatch | null {
  const body = String(text || "");
  const idx = body.lastIndexOf(DANGEROUS_CMD_PENDING_MARKER);
  if (idx < 0) return null;
  const rest = body.slice(idx + DANGEROUS_CMD_PENDING_MARKER.length);
  const cmd = rest
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("##"));
  if (!cmd) return null;
  return matchDangerousCommand(cmd) ?? {
    command: cmd,
    category: "unknown",
    summary: "危险命令",
  };
}

export function isDangerousCommandApproval(reply: string): boolean {
  const text = String(reply || "").trim();
  if (!text) return false;
  return text === DANGEROUS_CMD_APPROVE_REPLY || text.startsWith(`${DANGEROUS_CMD_APPROVE_REPLY}：`) || text.startsWith(`${DANGEROUS_CMD_APPROVE_REPLY}:`);
}

export function isDangerousCommandDenial(reply: string): boolean {
  const text = String(reply || "").trim();
  if (!text) return false;
  return text === DANGEROUS_CMD_DENY_REPLY || text.startsWith(`${DANGEROUS_CMD_DENY_REPLY}：`) || text.startsWith(`${DANGEROUS_CMD_DENY_REPLY}:`);
}

const APPROVED_BLOCK_RE =
  /---\nApproved dangerous command:\n([\s\S]*?)(?=\n---|\n## user|\n## 闸门|$)/g;

export function parseApprovedDangerousCommandIds(prompt: string): Set<string> {
  const ids = new Set<string>();
  const body = String(prompt || "");
  for (const m of body.matchAll(APPROVED_BLOCK_RE)) {
    const cmd = normalizeDangerousCommand(m[1] || "");
    if (cmd) ids.add(dangerousCommandId(cmd));
  }
  return ids;
}

export function appendDangerousCommandApproval(prompt: string, command: string): string {
  const cmd = normalizeDangerousCommand(command);
  if (!cmd) return prompt;
  const block = `---\nApproved dangerous command:\n${cmd}\n`;
  if (prompt.includes(block)) return prompt;
  return `${prompt.trim()}\n\n${block}`.trim();
}
