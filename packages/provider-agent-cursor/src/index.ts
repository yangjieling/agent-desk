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
  return process.env.AD_CURSOR_BIN || "agent";
}

function modelFlag(): string[] {
  const model = (process.env.AD_CURSOR_MODEL || "").trim();
  return model ? ["--model", model] : [];
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

function assistantText(evt: Record<string, unknown>): string | undefined {
  const message = evt.message;
  if (typeof message !== "object" || !message) return undefined;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((item) => {
      if (typeof item !== "object" || !item) return "";
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
  return parts || undefined;
}

function toolCommand(toolCall: Record<string, unknown>): string | undefined {
  const read = toolCall.readToolCall;
  if (typeof read === "object" && read) {
    const path = jsonField(read as Record<string, unknown>, ["path"]);
    if (path) return `read ${path}`;
  }

  const write = toolCall.writeToolCall;
  if (typeof write === "object" && write) {
    const path = jsonField(write as Record<string, unknown>, ["path"]);
    if (path) return `write ${path}`;
  }

  const shell = toolCall.shellToolCall ?? toolCall.bashToolCall ?? toolCall.terminalToolCall;
  if (typeof shell === "object" && shell) {
    const args = shell as Record<string, unknown>;
    const command = jsonField(args, ["command", "cmd"]);
    if (command) return command;
  }

  const fn = toolCall.function;
  if (typeof fn === "object" && fn) {
    const name = jsonField(fn as Record<string, unknown>, ["name"]);
    if (name) return name;
  }

  return undefined;
}

export class CursorBackend implements AgentBackend {
  readonly id = "cursor";
  readonly displayName = "Cursor Agent";

  supportsResume(): boolean {
    return true;
  }

  async requireReady(): Promise<void> {
    const r = spawnSync(bin(), ["--version"], { encoding: "utf8" });
    if (r.error || r.status !== 0) {
      throw new Error(
        `Cursor Agent CLI not found. Install with: curl https://cursor.com/install -fsS | bash (or set AD_CURSOR_BIN).`,
      );
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
    const args = [
      bin(),
      "-p",
      "--force",
      "--trust",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--workspace",
      params.cwd,
      ...modelFlag(),
    ];
    if (sessionId) {
      args.push("--resume", sessionId);
    }
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

      const sessionId = jsonField(evt, ["session_id", "sessionId"]);
      if (sessionId && (type === "system" || type === "result")) {
        return { type: "session", sessionId, raw: evt };
      }

      if (type === "assistant") {
        if ("model_call_id" in evt) return null;
        const text = assistantText(evt);
        if (text) return { type: "assistant", text, raw: evt };
        return null;
      }

      if (type === "tool_call" && evt.subtype === "started") {
        const toolCall =
          typeof evt.tool_call === "object" && evt.tool_call
            ? (evt.tool_call as Record<string, unknown>)
            : null;
        if (!toolCall) return null;
        const command = toolCommand(toolCall);
        if (command) return { type: "command", command, raw: evt };
      }

      if (type === "result") {
        if (evt.is_error === true) {
          const text = jsonField(evt, ["result", "message"]) || "cursor agent error";
          return { type: "error", text, raw: evt };
        }
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

export function registerCursorBackend(): CursorBackend {
  const backend = new CursorBackend();
  registerAgentBackend(backend);
  return backend;
}
