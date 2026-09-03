import type { AgentProfile, Settings } from "./types.js";

export interface ResolvedAgentConfig {
  agentProfileId: string;
  codingAgent: string;
  model: string;
  instructions: string;
  defaultSkill: string;
  skills: string[];
}

export function newAgentId(): string {
  return `a_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

/** Dedupe + drop empty / `default` entries; preserves order. */
export function normalizeAgentSkills(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of skills) {
    const id = String(raw || "").trim();
    if (!id || id === "default" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function resolveAgentConfig(
  profile: AgentProfile | null | undefined,
  settings: Settings,
  overrides?: {
    agentProfileId?: string;
    codingAgent?: string;
    model?: string;
    skill?: string;
  },
): ResolvedAgentConfig {
  const agentProfileId = (
    overrides?.agentProfileId?.trim() ||
    profile?.id?.trim() ||
    settings.defaultAgentId?.trim() ||
    ""
  ).trim();
  const codingAgent = (
    overrides?.codingAgent?.trim() ||
    profile?.provider?.trim() ||
    settings.codingAgent ||
    "claude"
  ).trim();
  const model = (
    overrides?.model !== undefined ? overrides.model : (profile?.model ?? settings.defaultModel)
  ).trim();
  const instructions = (profile?.instructions || "").trim();
  const overrideSkill = overrides?.skill?.trim() || "";
  const defaultSkill = (
    overrideSkill ||
    profile?.defaultSkill?.trim() ||
    "default"
  ).trim() || "default";
  return {
    agentProfileId,
    codingAgent,
    model,
    instructions,
    defaultSkill,
    skills: normalizeAgentSkills(profile?.skills),
  };
}

export function prependAgentInstructions(prompt: string, instructions: string): string {
  const ins = instructions.trim();
  if (!ins) return prompt;
  return `# Agent instructions\n\n${ins}\n\n---\n\n${prompt}`;
}
