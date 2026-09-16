import { spawnSync } from "node:child_process";
import { registerAgentBackend, listModelsForAgent, resolveAgentModel } from "@agent-desk/provider-agent";
import type {
  AgentBackend,
  AgentEvent,
  AgentExecParams,
  AgentResumeParams,
} from "@agent-desk/provider-agent";

/**
 * Extract Hermes session id from CLI text (usually stderr under -Q).
 * Typical: `session_id: 20260915_103054_6c2163`
 */
export function extractHermesSessionId(text: string): string {
  if (!text) return "";
  const line = text.match(
    /(?:^|\n)\s*session[_ ]?id\s*[:=]\s*([0-9]{8}_[0-9]{6}_[0-9a-fA-F]{4,})\s*(?=\n|$)/i,
  );
  if (line?.[1]) return line[1].trim();
  const any = text.match(/session[_ ]?id\s*[:=]\s*([0-9]{8}_[0-9]{6}_[0-9a-fA-F]{4,})/i);
  return any?.[1]?.trim() || "";
}

function bin(): string {
  return (process.env.AD_HERMES_BIN || "hermes").trim() || "hermes";
}

function modelFlag(params: AgentExecParams): string[] {
  const model = resolveAgentModel(params.model, process.env.AD_HERMES_MODEL);
  return model ? ["-m", model] : [];
}

function hermesConfigModel(binary: string): string {
  const r = spawnSync(binary, ["config", "get", "model"], {
    encoding: "utf8",
    timeout: 8_000,
  });
  if (r.error || r.status !== 0) return "";
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  const line = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  // Often `model: xxx` or bare id
  const m = line.match(/model\s*[:=]\s*(.+)$/i);
  return (m?.[1] || line).trim().replace(/^["']|["']$/g, "");
}

export class HermesBackend implements AgentBackend {
  readonly id = "hermes";
  readonly displayName = "Hermes Agent";

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
        `Hermes Agent CLI not found. Install Hermes or set AD_HERMES_BIN (tried \`${bin()}\`).`,
      );
    }
  }

  buildExecCommand(params: AgentExecParams): string[] {
    return this.buildChat(params);
  }

  buildResumeCommand(params: AgentResumeParams): string[] {
    return this.buildChat(params, params.sessionId);
  }

  private buildChat(params: AgentExecParams, sessionId?: string): string[] {
    // --oneshot / -Q: non-interactive final answer; --yolo: auto-approve tools.
    // Body on stdout; session_id typically on stderr. --resume continues a prior session.
    const args = [
      bin(),
      "chat",
      "--query-file",
      params.promptFile,
      "--oneshot",
      "-Q",
      "--yolo",
      "--in",
      params.cwd || ".",
      ...modelFlag(params),
    ];
    const sid = (sessionId || "").trim();
    if (sid) {
      args.push("--resume", sid === "latest" ? "latest" : sid);
    }
    return args;
  }

  parseEventLine(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (/^session[_ ]?id\s*[:=]/i.test(trimmed)) {
      const sid = extractHermesSessionId(trimmed);
      if (sid) return { type: "session", sessionId: sid, raw: trimmed };
    }

    // Hermes oneshot is plain text (not JSONL). Gate/status use raw log output;
    // only promote structured session markers into AgentEvent.
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const evt = JSON.parse(trimmed) as Record<string, unknown>;
        for (const key of ["session_id", "sessionId", "id"]) {
          const val = evt[key];
          if (typeof val === "string" && val.trim()) {
            const parsed = extractHermesSessionId(`session_id: ${val}`) || val.trim();
            if (parsed) return { type: "session", sessionId: parsed, raw: evt };
          }
        }
      } catch {
        /* plain text */
      }
    }

    return null;
  }

  extractSessionId(events: AgentEvent[]): string | null {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].sessionId) return events[i].sessionId!;
    }
    return null;
  }

  /** Fallback when session_id only appears in a multi-line stderr blob. */
  extractSessionFromOutput(output: string): string | null {
    const sid = extractHermesSessionId(output);
    return sid || null;
  }
}

export function registerHermesBackend(): HermesBackend {
  const backend = new HermesBackend();
  registerAgentBackend(backend);
  return backend;
}

/** Used by model catalog discovery. */
export function discoverHermesDefaultModel(binary?: string): string {
  return hermesConfigModel((binary || bin()).trim() || "hermes");
}
