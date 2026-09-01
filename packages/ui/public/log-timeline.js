/* Incremental task log → timeline parser (D3). Loaded before app.js. */
(function (global) {
  const LOG_LINE_TS_RE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?\] /;
  const CODEX_PLAIN_NOISE_RE = /^Reading additional input from stdin/i;

  function stripStoredLogPrefix(line) {
    return String(line || "").replace(LOG_LINE_TS_RE, "");
  }

  function unwrapShellCommand(command) {
    let cmd = String(command || "").trim();
    const m = cmd.match(/^\/bin\/(?:zsh|bash)\s+-lc\s+(['"])([\s\S]*)\1\s*$/);
    if (m) return m[2];
    return cmd;
  }

  function shortenText(text, max = 96) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
  }

  function formatCommandActivity(command, running) {
    const cmd = unwrapShellCommand(command);
    if (!cmd) return running ? "Running command…" : "Ran command";
    if (/\brg\b|\bgrep\b/i.test(cmd)) {
      const pattern = (cmd.match(/['"]([^'"]+)['"]/) || [])[1] || cmd.split(/\s+/).slice(-1)[0] || "";
      return running ? `Grepping ${shortenText(pattern, 72)}` : `Grepped ${shortenText(pattern, 72)}`;
    }
    if (/\bgh\b/i.test(cmd) && /\bissue\b/i.test(cmd)) {
      return running ? `Running ${shortenText(cmd, 80)}` : `Ran ${shortenText(cmd, 80)}`;
    }
    if (/\bsqlite3\b/i.test(cmd)) {
      const target = (cmd.match(/sqlite3\s+(\S+)/i) || [])[1] || "sqlite3";
      return running ? `Running Query ${target}` : `Ran Query ${target}`;
    }
    if (/\bfind\b/i.test(cmd) && /\bread\b/i.test(cmd)) {
      return running ? `Reading ${shortenText(cmd, 80)}` : `Read ${shortenText(cmd, 80)}`;
    }
    if (/\bcat\b|\bhead\b|\btail\b|\bsed\b/i.test(cmd)) {
      return running ? `Reading ${shortenText(cmd, 80)}` : `Read ${shortenText(cmd, 80)}`;
    }
    if (/\bgit\b/i.test(cmd)) {
      return running ? `Running ${shortenText(cmd, 72)}` : `Ran ${shortenText(cmd, 72)}`;
    }
    return running ? `Running ${shortenText(cmd, 80)}` : `Ran ${shortenText(cmd, 80)}`;
  }

  function jsonField(obj, keys) {
    if (!obj || typeof obj !== "object") return "";
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function formatCursorToolActivity(toolCall, running) {
    if (!toolCall || typeof toolCall !== "object") {
      return running ? "Running tool…" : "Ran tool";
    }
    const read = toolCall.readToolCall;
    if (read && typeof read === "object") {
      const path = jsonField(read, ["path"]);
      return running ? `Reading ${path || "file"}` : `Read ${path || "file"}`;
    }
    const write = toolCall.writeToolCall;
    if (write && typeof write === "object") {
      const path = jsonField(write, ["path"]);
      return running ? `Writing ${path || "file"}` : `Wrote ${path || "file"}`;
    }
    const shell =
      toolCall.shellToolCall || toolCall.bashToolCall || toolCall.terminalToolCall;
    if (shell && typeof shell === "object") {
      const command = jsonField(shell, ["command", "cmd"]);
      return formatCommandActivity(command || "shell", running);
    }
    const fn = toolCall.function;
    if (fn && typeof fn === "object") {
      const name = jsonField(fn, ["name"]) || "tool";
      return running ? `Running ${name}` : `Ran ${name}`;
    }
    return running ? "Running tool…" : "Ran tool";
  }

  function pushTimelineItem(items, type, text, extra) {
    const body = String(text || "");
    if (!body.trim() && type !== "tool" && type !== "activity") return;
    const delta = !!(extra && extra.delta);
    const noMerge = !!(extra && extra.noMerge);
    const last = items[items.length - 1];
    if (last && last.type === type && type === "assistant" && body && !noMerge) {
      if (delta) last.text = String(last.text || "") + body;
      else last.text = `${last.text}\n${body}`.trim();
      return;
    }
    items.push({ type, text: delta ? body : body.trim(), ...(extra || {}) });
  }

  function pushOrUpdateActivity(items, activityById, id, text, status) {
    const key = String(id || text || "activity");
    let item = activityById.get(key);
    if (item) {
      item.text = text;
      item.status = status;
      return;
    }
    item = { type: "activity", id: key, text, status };
    activityById.set(key, item);
    items.push(item);
  }

  function parseCodexStreamEvent(evt, items, activityById) {
    const type = String(evt.type || "");
    if (type === "thread.started" || type === "turn.started" || type === "turn.completed") {
      return null;
    }

    if (
      type === "item.delta" ||
      type === "item/agentMessage/delta" ||
      type === "item.agent_message.delta"
    ) {
      let deltaText = evt.text;
      if (!deltaText && typeof evt.delta === "object" && evt.delta) {
        deltaText = evt.delta.text ?? evt.delta.content;
      }
      return deltaText ? { kind: "assistant", text: String(deltaText), delta: true } : null;
    }

    if (type !== "item.completed" && type !== "item.started") return null;

    const item = typeof evt.item === "object" && evt.item ? evt.item : null;
    if (!item) return null;
    const itemType = String(item.type || "");
    const itemId = jsonField(item, ["id"]) || `${itemType}:${String(item.command || "").slice(0, 40)}`;

    if (itemType === "agent_message" || itemType === "agentMessage") {
      const text = String(item.text || "").trim();
      if (!text || type !== "item.completed") return null;
      return { kind: "assistant", text };
    }

    if (itemType === "command_execution" || itemType === "commandExecution") {
      const command = String(item.command || "").trim();
      if (!command) return null;
      if (type === "item.started") {
        return {
          kind: "activity",
          id: itemId,
          text: formatCommandActivity(command, true),
          status: "running",
        };
      }
      return {
        kind: "activity",
        id: itemId,
        text: formatCommandActivity(command, false),
        status: "done",
      };
    }

    if (itemType === "error") {
      const text = String(item.message || "").trim();
      return text ? { kind: "system", text } : null;
    }

    return null;
  }

  function applyJsonEvent(evt, items, helpers, activityById) {
    const type = String(evt.type || "");
    if (type === "assistant") {
      const content = evt.message && evt.message.content;
      const textPart = helpers.extractTextFromContent(content);
      const tools = helpers.extractToolsFromContent(content);
      const isPartial = "model_call_id" in evt;
      if (textPart) pushTimelineItem(items, "assistant", textPart, isPartial ? { delta: true } : undefined);
      for (const t of tools) {
        pushTimelineItem(items, "tool", t.name, {
          toolName: t.name,
          detail: helpers.prettyJson(t.input),
        });
      }
      return;
    }
    if (type === "tool_call") {
      const subtype = String(evt.subtype || "");
      const toolCall =
        typeof evt.tool_call === "object" && evt.tool_call ? evt.tool_call : null;
      const callId =
        jsonField(evt, ["call_id", "callId"]) ||
        jsonField(toolCall || {}, ["id"]) ||
        formatCursorToolActivity(toolCall, subtype === "started");
      if (subtype === "started") {
        pushOrUpdateActivity(
          items,
          activityById,
          callId,
          formatCursorToolActivity(toolCall, true),
          "running",
        );
      } else if (subtype === "completed") {
        pushOrUpdateActivity(
          items,
          activityById,
          callId,
          formatCursorToolActivity(toolCall, false),
          "done",
        );
      }
      return;
    }
    if (
      type === "item.delta" ||
      type === "item/agentMessage/delta" ||
      type === "item.agent_message.delta"
    ) {
      let deltaText = evt.text;
      if (!deltaText && typeof evt.delta === "object" && evt.delta) {
        deltaText = evt.delta.text ?? evt.delta.content;
      }
      if (deltaText) pushTimelineItem(items, "assistant", String(deltaText), { delta: true });
      return;
    }
    if (type === "user") {
      const content = evt.message && evt.message.content;
      const textPart = helpers.extractTextFromContent(content);
      const toolResults = Array.isArray(content)
        ? content.filter((c) => c && c.type === "tool_result")
        : [];
      if (toolResults.length) {
        for (const tr of toolResults) {
          const detail =
            typeof tr.content === "string" ? tr.content : helpers.prettyJson(tr.content ?? tr);
          pushTimelineItem(items, "tool", "tool_result", {
            toolName: "结果",
            detail: String(detail).slice(0, 4000),
          });
        }
      } else if (textPart) {
        pushTimelineItem(items, "user", textPart);
      }
      return;
    }
    if (type === "result") {
      const summary = evt.result != null ? String(evt.result) : "";
      if (summary && summary !== "null") {
        pushTimelineItem(items, "system", summary.slice(0, 2000));
      }
      return;
    }
    if (type === "system" || type === "error") {
      const subtype = String(evt.subtype || "");
      if (type === "system" && (subtype === "init" || subtype === "turn_end")) return;
      const msg = evt.message || evt.error || evt.subtype || type;
      pushTimelineItem(items, "system", typeof msg === "string" ? msg : helpers.prettyJson(msg));
      return;
    }
    const codex = parseCodexStreamEvent(evt, items, activityById);
    if (codex?.kind === "assistant") {
      pushTimelineItem(
        items,
        "assistant",
        codex.text,
        codex.delta ? { delta: true } : { noMerge: true },
      );
    } else if (codex?.kind === "activity") {
      pushOrUpdateActivity(items, activityById, codex.id, codex.text, codex.status);
    } else if (codex?.kind === "system") {
      pushTimelineItem(items, "system", codex.text);
    }
  }

  function createIncrementalLogParser(helpers) {
    const ctx = { items: [], plainBuf: [], activityById: new Map() };
    let lineRemainder = "";

    function flushPlain() {
      const chunk = ctx.plainBuf.join("\n").trim();
      ctx.plainBuf = [];
      if (!chunk) return;
      if (/^##\s*user\b/i.test(chunk) || /^\[user abort:/i.test(chunk)) {
        const userText = chunk
          .replace(/^##\s*user\s*/i, "")
          .replace(/^\[user abort:\s*/i, "")
          .replace(/\]\s*$/, "")
          .trim();
        pushTimelineItem(ctx.items, "user", userText || chunk);
        return;
      }
      if (/##\s*闸门|##\s*oh-choices|##\s*hb-choices/.test(chunk)) {
        pushTimelineItem(ctx.items, "gate", chunk);
        return;
      }
      if (CODEX_PLAIN_NOISE_RE.test(chunk)) return;
      pushTimelineItem(ctx.items, "assistant", chunk);
    }

    function processLine(line) {
      const trimmed = line.trim();
      if (!trimmed) {
        ctx.plainBuf.push(line);
        return;
      }
      const bare = stripStoredLogPrefix(trimmed);
      if (bare.startsWith("$ ")) {
        flushPlain();
        pushTimelineItem(ctx.items, "system", bare);
        return;
      }
      if (bare.startsWith("{") && bare.endsWith("}")) {
        try {
          const evt = JSON.parse(bare);
          flushPlain();
          applyJsonEvent(evt, ctx.items, helpers, ctx.activityById);
          return;
        } catch {
          /* fall through as plain */
        }
      }
      ctx.plainBuf.push(line);
    }

    function feedLines(text) {
      const all = lineRemainder + text;
      const parts = all.split("\n");
      lineRemainder = parts.pop() ?? "";
      for (const line of parts) processLine(line);
      return ctx.items;
    }

    function resetState() {
      ctx.items = [];
      ctx.plainBuf = [];
      ctx.activityById = new Map();
      lineRemainder = "";
    }

    return {
      reset(raw) {
        resetState();
        if (raw) {
          feedLines(String(raw));
          if (lineRemainder) {
            processLine(lineRemainder);
            lineRemainder = "";
          }
          flushPlain();
        }
        return ctx.items;
      },
      append(text) {
        if (!text) return ctx.items;
        feedLines(String(text));
        return ctx.items;
      },
      finalize() {
        if (lineRemainder) {
          processLine(lineRemainder);
          lineRemainder = "";
        }
        flushPlain();
        for (const item of ctx.activityById.values()) {
          if (item.status === "running") item.status = "done";
        }
        return ctx.items;
      },
      getItems() {
        return ctx.items;
      },
    };
  }

  function parseLogTimeline(raw, helpers) {
    return createIncrementalLogParser(helpers).reset(raw || "");
  }

  global.createIncrementalLogParser = createIncrementalLogParser;
  global.parseLogTimeline = parseLogTimeline;
})(typeof window !== "undefined" ? window : globalThis);
