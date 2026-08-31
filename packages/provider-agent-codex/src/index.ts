import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { registerAgentBackend } from "@agent-desk/provider-agent";
import type {
  AgentBackend,
  AgentEvent,
  AgentExecParams,
  AgentResumeParams,
} from "@agent-desk/provider-agent";

function bin(): string {
  return process.env.AD_CODEX_BIN || "codex";
}

function modelFlag(): string[] {
  const model = (process.env.AD_CODEX_MODEL || "").trim();
  return model ? ["-m", model] : [];
}

function readPrompt(promptFile: string): string {
  return fs.readFileSync(promptFile, "utf8");
}

function jsonField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

export class CodexBackend implements AgentBackend {
  readonly id = "codex";
  readonly displayName = "Codex";

  supportsResume(): boolean {
    return true;
  }

  async requireReady(): Promise<void> {
    const r = spawnSync(bin(), ["--version"], { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      throw new Error(`Codex CLI not found. Install codex or set AD_CODEX_BIN.`);
    }
  }

  buildExecCommand(params: AgentExecParams): string[] {
    return this.buildArgs(params);
  }

  buildResumeCommand(params: AgentResumeParams): string[] {
    return this.buildArgs(params, params.sessionId);
  }

  private buildArgs(params: AgentExecParams, sessionId?: string): string[] {
    const prompt = readPrompt(params.promptFile);
    const args = [bin(), "exec"];
    if (sessionId) {
      args.push("resume", sessionId);
    }
    args.push(
      "--skip-git-repo-check",
      "--json",
      "--color",
      "never",
      "--dangerously-bypass-approvals-and-sandbox",
      ...modelFlag(),
      "-C",
      params.cwd,
    );
    for (const dir of params.extraSkillDirs ?? []) {
      const d = (dir || "").trim();
      if (d) args.push("--add-dir", d);
    }
    args.push(prompt);
    return args;
  }

  parseEventLine(line: string): AgentEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const evt = JSON.parse(trimmed) as Record<string, unknown>;
      const type = String(evt.type || "");

      if (type === "thread.started") {
        const sessionId = jsonField(evt, ["thread_id", "threadId"]);
        if (sessionId) return { type: "session", sessionId, raw: evt };
      }

      if (type === "error") {
        const text =
          jsonField(evt, ["message"]) ||
          (typeof evt.error === "object" && evt.error
            ? jsonField(evt.error as Record<string, unknown>, ["message"])
            : undefined);
        return { type: "error", text: text || "codex error", raw: evt };
      }

      if (
        type === "item.delta" ||
        type === "item/agentMessage/delta" ||
        type === "item.agent_message.delta"
      ) {
        let text = jsonField(evt, ["text"]);
        if (!text && typeof evt.delta === "object" && evt.delta) {
          text = jsonField(evt.delta as Record<string, unknown>, ["text"]);
        }
        if (text) return { type: "assistant", text, raw: evt };
      }

      if (type === "item.completed" || type === "item.started") {
        const item =
          typeof evt.item === "object" && evt.item
            ? (evt.item as Record<string, unknown>)
            : null;
        if (!item) return { type: "turn_end", raw: evt };
        const itemType = String(item.type || "");
        if (itemType === "agent_message" || itemType === "agentMessage") {
          const text = jsonField(item, ["text"]);
          if (text && type === "item.completed") {
            return { type: "assistant", text, raw: evt };
          }
        }
        if (itemType === "command_execution" || itemType === "commandExecution") {
          const command = jsonField(item, ["command"]);
          if (command) return { type: "command", command, raw: evt };
        }
      }

      if (type === "turn.completed") {
        return { type: "turn_end", raw: evt };
      }

      return null;
    } catch {
      return null;
    }
  }

  extractSessionId(events: AgentEvent[]): string | null {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].sessionId) return events[i].sessionId!;
    }
    return null;
  }
}

export function registerCodexBackend(): CodexBackend {
  const backend = new CodexBackend();
  registerAgentBackend(backend);
  return backend;
}
