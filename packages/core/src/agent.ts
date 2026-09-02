import type { AgentProfile, Settings } from "./types.js";

export interface ResolvedAgentConfig {
  agentProfileId: string;
  codingAgent: string;
  model: string;
  instructions: string;
  defaultSkill: string;
}

export function newAgentId(): string {
  return `a_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
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
  const defaultSkill = (
    overrides?.skill?.trim() ||
    profile?.defaultSkill?.trim() ||
    "default"
  ).trim() || "default";
  return { agentProfileId, codingAgent, model, instructions, defaultSkill };
}

export function prependAgentInstructions(prompt: string, instructions: string): string {
  const ins = instructions.trim();
  if (!ins) return prompt;
  return `# Agent instructions\n\n${ins}\n\n---\n\n${prompt}`;
}
