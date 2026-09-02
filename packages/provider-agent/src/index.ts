export type AgentId = string;

export interface AgentExecParams {
  cwd: string;
  promptFile: string;
  /** Skill bundle dirs for CLIs that support --add-dir (or equivalent). */
  extraSkillDirs?: string[];
  env?: Record<string, string>;
  /** LLM model override; empty = follow CLI default / env fallback. */
  model?: string;
}

export interface AgentResumeParams extends AgentExecParams {
  sessionId: string;
}

export type AgentEventType =
  | "assistant"
  | "command"
  | "session"
  | "error"
  | "turn_end";

export interface AgentEvent {
  type: AgentEventType;
  text?: string;
  command?: string;
  sessionId?: string;
  raw?: unknown;
}

export class AgentLoginRequired extends Error {
  readonly code = "agent_login_required";
  constructor(message: string, readonly agentId: AgentId) {
    super(message);
    this.name = "AgentLoginRequired";
  }
}

export interface AgentBackend {
  readonly id: AgentId;
  readonly displayName: string;
  supportsResume(): boolean;
  modelSelectionSupported(): boolean;
  listModels(): Promise<import("./models.js").AgentModelCatalog>;
  requireReady(): Promise<void>;
  buildExecCommand(params: AgentExecParams): string[];
  buildResumeCommand(params: AgentResumeParams): string[];
  parseEventLine(line: string): AgentEvent | null;
  extractSessionId(events: AgentEvent[]): string | null;
}

import { probeAllAgentProviders, probeInstalledAgentProviders } from "./probe.js";

const registry = new Map<AgentId, AgentBackend>();

export function registerAgentBackend(backend: AgentBackend): void {
  registry.set(backend.id, backend);
}

export function getAgentBackend(id: AgentId): AgentBackend {
  const b = registry.get(id);
  if (!b) throw new Error(`Unknown agent backend: ${id}`);
  return b;
}

export function listAgentBackends(): AgentBackend[] {
  return [...registry.values()];
}

function backendProbeRows() {
  return listAgentBackends().map((b) => ({ id: b.id, displayName: b.displayName }));
}

export function listInstalledAgentProviders(options?: { fresh?: boolean }) {
  return probeInstalledAgentProviders(backendProbeRows(), options);
}

export function listAgentRuntimes(options?: { fresh?: boolean }) {
  return probeAllAgentProviders(backendProbeRows(), options);
}

export * from "./models.js";
export * from "./probe.js";
