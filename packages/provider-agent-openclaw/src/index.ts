import { spawnSync } from "node:child_process";
import { registerAgentBackend, listModelsForAgent, resolveAgentModel } from "@agent-desk/provider-agent";
import type {
  AgentBackend,
  AgentEvent,
  AgentExecParams,
  AgentResumeParams,
} from "@agent-desk/provider-agent";

/**
 * OpenClaw headless coding backend.
 * Fresh runs: `openclaw agent exec --message-file … --cwd … --json`
 * Resume: `openclaw agent --local --message-file … --session-id … --json`
 */
export function extractOpenClawSessionId(text: string): string {
  if (!text) return "";
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const evt = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ["sessionId", "session_id"]) {
        const val = evt[key];
        if (typeof val === "string" && val.trim()) return val.trim();
      }
    }
  } catch {
    /* fall through */
  }
  const m = text.match(/"sessionId"\s*:\s*"([^"]+)"/);
  return m?.[1]?.trim() || "";
}

function bin(): string {
  return (process.env.AD_OPENCLAW_BIN || "openclaw").trim() || "openclaw";
}

function modelFlag(params: AgentExecParams): string[] {
  const model = resolveAgentModel(params.model, process.env.AD_OPENCLAW_MODEL);
  return model ? ["--model", model] : [];
}

export class OpenClawBackend implements AgentBackend {
  readonly id = "openclaw";
  readonly displayName = "OpenClaw";

  supportsResume(): boolean {
    return true;
  }

  modelSelectionSupported(): boolean {
    return true;
  }

  async listModels() {
    return listModelsForAgent(this.id, bin());
  }

  async requireReady(): Promise<void> {
    const r = spawnSync(bin(), ["--version"], { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      throw new Error(
        `OpenClaw CLI not found. Install OpenClaw or set AD_OPENCLAW_BIN (tried \`${bin()}\`).`,
      );
    }
  }

  buildExecCommand(params: AgentExecParams): string[] {
    return [
      bin(),
      "agent",
      "exec",
      "--message-file",
      params.promptFile,
      "--cwd",
      params.cwd || ".",
      "--json",
      ...modelFlag(params),
    ];
  }

  buildResumeCommand(params: AgentResumeParams): string[] {
    const sid = (params.sessionId || "").trim();
    // Gateway-local turn keeps session continuity; exec is always a fresh turn.
    return [
      bin(),
      "agent",
      "--local",
      "--message-file",
      params.promptFile,
      "--session-id",
      sid || "latest",
      "--json",
      ...modelFlag(params),
    ];
  }

  parseEventLine(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return null;
    try {
      const evt = JSON.parse(trimmed) as Record<string, unknown>;
      const sid =
        (typeof evt.sessionId === "string" && evt.sessionId.trim()) ||
        (typeof evt.session_id === "string" && evt.session_id.trim()) ||
        "";
      if (sid) return { type: "session", sessionId: sid, raw: evt };

      if (evt.ok === false || evt.status === "error" || evt.status === "timeout") {
        const err = evt.error;
        const message =
          typeof err === "object" && err && "message" in err
            ? String((err as { message?: unknown }).message || "OpenClaw error")
            : typeof err === "string"
              ? err
              : "OpenClaw run failed";
        return { type: "error", text: message, raw: evt };
      }

      const finalText = typeof evt.final === "string" ? evt.final.trim() : "";
      if (finalText) return { type: "assistant", text: finalText, raw: evt };
    } catch {
      return null;
    }
    return null;
  }

  extractSessionId(events: AgentEvent[]): string | null {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].sessionId) return events[i].sessionId!;
    }
    return null;
  }

  extractSessionFromOutput(output: string): string | null {
    return extractOpenClawSessionId(output) || null;
  }
}

export function registerOpenClawBackend(): OpenClawBackend {
  const backend = new OpenClawBackend();
  registerAgentBackend(backend);
  return backend;
}
