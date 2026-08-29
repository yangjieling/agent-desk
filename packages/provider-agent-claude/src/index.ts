import { spawnSync } from "node:child_process";
import { registerAgentBackend } from "@agent-desk/provider-agent";
import type {
  AgentBackend,
  AgentEvent,
  AgentExecParams,
  AgentResumeParams,
} from "@agent-desk/provider-agent";

function bin(): string {
  return process.env.AD_CLAUDE_BIN || "claude";
}

export class ClaudeBackend implements AgentBackend {
  readonly id = "claude";
  readonly displayName = "Claude Code";

  supportsResume(): boolean {
    return true;
  }

  async requireReady(): Promise<void> {
    const r = spawnSync(bin(), ["--version"], { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      throw new Error(`Claude CLI not found. Install claude or set AD_CLAUDE_BIN.`);
    }
  }

  buildExecCommand(params: AgentExecParams): string[] {
    return this.buildArgs(params);
  }

  buildResumeCommand(params: AgentResumeParams): string[] {
    return this.buildArgs(params, params.sessionId);
  }

  private buildArgs(params: AgentExecParams, sessionId?: string): string[] {
    const args = [bin(), "-p"];
    if (sessionId) {
      args.push("--resume", sessionId);
    }
    args.push("--output-format", "stream-json", "--dangerously-skip-permissions");
    for (const dir of params.extraSkillDirs ?? []) {
      const d = (dir || "").trim();
      if (d) args.push("--add-dir", d);
    }
    args.push("--", params.promptFile);
    return args;
  }

  parseEventLine(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const evt = JSON.parse(trimmed) as Record<string, unknown>;
      const type = String(evt.type || "");
      if (type === "assistant" && typeof evt.message === "object") {
        const content = (evt.message as { content?: unknown }).content;
        const text = Array.isArray(content)
          ? content
              .map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: string }).text) : ""))
              .join("")
          : String(content ?? "");
        return { type: "assistant", text, raw: evt };
      }
      if (type === "result" && evt.session_id) {
        return { type: "session", sessionId: String(evt.session_id), raw: evt };
      }
      return { type: "turn_end", raw: evt };
    } catch {
      return { type: "assistant", text: trimmed };
    }
  }

  extractSessionId(events: AgentEvent[]): string | null {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].sessionId) return events[i].sessionId!;
    }
    return null;
  }
}

export function registerClaudeBackend(): ClaudeBackend {
  const backend = new ClaudeBackend();
  registerAgentBackend(backend);
  return backend;
}
