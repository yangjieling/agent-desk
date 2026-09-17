/**
 * Failover: pick the next agent profile after a task failure.
 */
import type { AgentProfile, Settings, Task } from "./types.js";

export type FailoverCandidate = {
  agentProfileId: string;
  codingAgent: string;
  model: string;
  label: string;
};

export function failoverPolicy(settings: Settings): {
  enabled: boolean;
  max: number;
  agentIds: string[];
} {
  return {
    enabled: settings.failoverOnFailureEnabled !== false,
    max: Math.max(0, Number(settings.maxFailovers ?? 2)),
    agentIds: Array.isArray(settings.failoverAgentIds)
      ? settings.failoverAgentIds.map((s) => String(s).trim()).filter(Boolean)
      : [],
  };
}

/** Failures where switching agent can help (CLI missing / backend down / exhausted retries). */
export function isFailoverEligibleFailure(code: string | undefined): boolean {
  const c = (code || "").trim();
  if (!c) return false;
  if (c === "orphan_after_restart" || c === "idle_timeout" || c === "workspace_busy") {
    return false;
  }
  return (
    c === "spawn_error" ||
    c === "backend_unavailable" ||
    c === "exit_nonzero" ||
    c === "start_error" ||
    c === "claim_expired"
  );
}

/**
 * Choose the next failover agent.
 * Prefer settings.failoverAgentIds order; if empty, use other profiles (newest first).
 */
export function pickNextFailoverAgent(input: {
  task: Task;
  settings: Settings;
  agents: AgentProfile[];
}): FailoverCandidate | null {
  const policy = failoverPolicy(input.settings);
  if (!policy.enabled || policy.max <= 0) return null;
  const used = Math.max(0, Number(input.task.failoverCount ?? 0));
  if (used >= policy.max) return null;

  const curProfile = (input.task.agentProfileId || "").trim();
  const curAgent = (input.task.codingAgent || "").trim();

  const byId = new Map(input.agents.map((a) => [a.id, a]));
  let ordered: AgentProfile[] = [];
  if (policy.agentIds.length) {
    for (const id of policy.agentIds) {
      const a = byId.get(id);
      if (a) ordered.push(a);
    }
  } else {
    ordered = [...input.agents].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  const candidates = ordered.filter((a) => {
    if (curProfile && a.id === curProfile) return false;
    const provider = (a.provider || "").trim();
    if (curAgent && provider === curAgent && !curProfile) return false;
    if (!provider) return false;
    return true;
  });

  const next = candidates[used];
  if (!next) return null;
  const codingAgent = (next.provider || "").trim();
  if (!codingAgent) return null;
  return {
    agentProfileId: next.id,
    codingAgent,
    model: (next.model || "").trim(),
    label: `${next.name} · ${codingAgent}`,
  };
}
