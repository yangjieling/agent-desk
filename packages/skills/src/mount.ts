import type { SkillDescriptor, SkillLookupOptions, SkillMount } from "./types.js";
import { listSkillDescriptors, normalizeSkillId, resolveSkill } from "./registry.js";

const MAX_CHARS = Number(process.env.AD_SKILL_PROMPT_MAX_CHARS || 100_000);

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 20))}\n\n…(truncated)`;
}

/** Prompt block for coding CLIs that do not auto-load skill dirs (hb-cli style). */
export function renderPromptBlock(skill: SkillDescriptor): string {
  const body = truncate(skill.instructions || "(empty)", MAX_CHARS);
  const parts = [
    `【编码运行时】agent-desk 已注入技能「${skill.name}」(${skill.id})。`,
    "请严格按照下列技能说明执行；不要改用无关流程。",
    "人机闸门请使用 ## 闸门「名称」 与 ## oh-choices；abort 回复（skip / 先不修）会终止任务。",
  ];
  if (skill.dir) {
    parts.push(`技能目录(可用 Read / Bash 访问): \`${skill.dir}\``);
  }
  if (skill.scripts.length) {
    parts.push(
      "技能脚本请用绝对路径调用:\n" + skill.scripts.map((p) => `- \`${p}\``).join("\n"),
    );
    parts.push("调用脚本时 cwd 仍是当前代码仓库；不要假设相对路径 `scripts/` 指向本技能。");
  }
  if (skill.description) {
    parts.push(`简介: ${skill.description}`);
  }
  parts.push("");
  parts.push(`===== SKILL.md · ${skill.id} =====`);
  parts.push(body);
  return parts.join("\n").trim() + "\n";
}

function missingHint(skillId: string): string {
  return [
    `【技能「${skillId}」】`,
    "未在本机找到对应的 SKILL.md（已搜索 .agent-desk/skills、.agents/skills、~/.agent-desk/skills、内置 templates/skills）。",
    "请根据任务描述尽力完成；需要专用脚本或参考文件时先说明缺失项。",
    "",
  ].join("\n");
}

/**
 * Resolve a skill id into prompt prefix + extra dirs for the agent backend.
 * Unknown / `default` skills get an empty or hint prefix and no dirs.
 */
export function mountSkill(skillId: string, opts: SkillLookupOptions = {}): SkillMount {
  const id = normalizeSkillId(skillId) || "default";
  if (!id || id === "default") {
    return {
      skillId: "default",
      promptPrefix: "",
      extraSkillDirs: [],
      descriptor: null,
    };
  }
  const descriptor = resolveSkill(id, opts);
  if (!descriptor) {
    return {
      skillId: id,
      promptPrefix: missingHint(id),
      extraSkillDirs: [],
      descriptor: null,
    };
  }
  const dirs: string[] = [];
  if (descriptor.dir) dirs.push(descriptor.dir);
  return {
    skillId: descriptor.id,
    promptPrefix: renderPromptBlock(descriptor),
    extraSkillDirs: dirs,
    descriptor,
  };
}

export function listSkillSummaries(opts: SkillLookupOptions = {}) {
  return listSkillDescriptors(opts).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    source: s.source,
    path: s.path,
    dir: s.dir,
    managed: !!s.managed,
    removable: !!s.removable,
    version: s.version,
  }));
}
