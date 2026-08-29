export type AgentId = string;

export interface AgentExecParams {
  cwd: string;
  promptFile: string;
  /** Skill bundle dirs for CLIs that support --add-dir (or equivalent). */
  extraSkillDirs?: string[];
  env?: Record<string, string>;
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
  requireReady(): Promise<void>;
  buildExecCommand(params: AgentExecParams): string[];
  buildResumeCommand(params: AgentResumeParams): string[];
  parseEventLine(line: string): AgentEvent | null;
  extractSessionId(events: AgentEvent[]): string | null;
}

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
