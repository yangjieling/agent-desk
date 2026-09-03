/** Local timestamp prefix for task log lines, e.g. [2026-08-31 11:02:03.456] */
export function formatLogTimestamp(date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  return `[${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}]`;
}

/** Shell-safe display of argv (prompt is usually a file path after `--`). */
export function formatCommandForLog(cmd: string[]): string {
  const out: string[] = [];
  for (const arg of cmd) {
    if (
      arg.length > 240 &&
      !arg.startsWith("-") &&
      (arg.includes("\n") || (!arg.includes("/") && arg.includes(" ")))
    ) {
      out.push("<prompt>");
      continue;
    }
    out.push(arg);
  }
  return out.join(" ");
}

export function formatCommandLogLine(cmd: string[]): string {
  return `${formatLogTimestamp()} $ ${formatCommandForLog(cmd)}\n\n`;
}

/** Structured startup / progress activity for the session timeline. */
export function formatActivityLogLine(
  id: string,
  text: string,
  status: "running" | "done" = "done",
): string {
  const payload = JSON.stringify({
    type: "activity",
    id: String(id || "activity"),
    text: String(text || "").trim() || "…",
    status,
  });
  return `${formatLogTimestamp()} ${payload}\n`;
}

/** Human-readable agent label for startup activities. */
export function agentStartupLabel(agentId: string): string {
  const id = String(agentId || "").toLowerCase();
  if (id.includes("claude")) return "Claude";
  if (id.includes("codex")) return "Codex";
  if (id.includes("cursor")) return "Cursor";
  return agentId || "Agent";
}

export interface LogLinePrefixer {
  append(chunk: string): string;
  flush(): string;
}

/** Prefix each complete line in agent stdout/stderr with a timestamp. */
export function createLogLinePrefixer(): LogLinePrefixer {
  let carry = "";
  return {
    append(chunk: string): string {
      if (!chunk) return "";
      const combined = carry + chunk;
      const endsWithNl = combined.endsWith("\n");
      const parts = combined.split("\n");
      carry = endsWithNl ? "" : parts.pop() ?? "";
      const lines = parts.map((line) => {
        if (line.length === 0) return "";
        return `${formatLogTimestamp()} ${line}`;
      });
      let out = lines.join("\n");
      if (parts.length > 0 && endsWithNl) out += "\n";
      return out;
    },
    flush(): string {
      if (!carry) return "";
      const line = `${formatLogTimestamp()} ${carry}`;
      carry = "";
      return line;
    },
  };
}
