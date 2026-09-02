/**
 * Extract LLM token / cost summaries from agent stream-json logs.
 * Claude Code first (Multica-shaped); other providers can be added later.
 */

const LOG_LINE_TS_RE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?\] /;

export interface TaskUsageSummary {
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Present only when the CLI reported a dollar cost. */
  costUsd: number | null;
}

function asNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    if (obj[k] != null) {
      const n = asNumber(obj[k]);
      if (n > 0) return n;
    }
  }
  return 0;
}

function usageFromClaudeUsageObject(usage: Record<string, unknown>): Omit<TaskUsageSummary, "provider" | "costUsd"> {
  return {
    inputTokens: pickNum(usage, ["input_tokens", "inputTokens", "input"]),
    outputTokens: pickNum(usage, ["output_tokens", "outputTokens", "output"]),
    cacheReadTokens: pickNum(usage, [
      "cache_read_input_tokens",
      "cacheReadInputTokens",
      "cache_read_tokens",
      "cacheReadTokens",
    ]),
    cacheWriteTokens: pickNum(usage, [
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
      "cache_write_tokens",
      "cacheWriteTokens",
    ]),
  };
}

function hasAnyTokens(u: Omit<TaskUsageSummary, "provider" | "costUsd">): boolean {
  return u.inputTokens > 0 || u.outputTokens > 0 || u.cacheReadTokens > 0 || u.cacheWriteTokens > 0;
}

function costFromUnknown(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Prefer the last Claude stream-json `type:"result"` line (session totals). */
export function extractClaudeUsageFromLog(result: string): TaskUsageSummary | null {
  const lines = String(result || "").split("\n");
  let best: TaskUsageSummary | null = null;

  for (const line of lines) {
    const bare = line.replace(LOG_LINE_TS_RE, "").trim();
    if (!bare.startsWith("{") || !bare.endsWith("}")) continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(bare) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (evt.type !== "result") continue;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let costUsd: number | null = null;

    const modelUsage = evt.modelUsage;
    if (modelUsage && typeof modelUsage === "object" && !Array.isArray(modelUsage)) {
      for (const raw of Object.values(modelUsage as Record<string, unknown>)) {
        if (!raw || typeof raw !== "object") continue;
        const part = usageFromClaudeUsageObject(raw as Record<string, unknown>);
        inputTokens += part.inputTokens;
        outputTokens += part.outputTokens;
        cacheReadTokens += part.cacheReadTokens;
        cacheWriteTokens += part.cacheWriteTokens;
        const c = costFromUnknown((raw as Record<string, unknown>).costUSD);
        if (c != null) costUsd = (costUsd ?? 0) + c;
      }
    }

    if (!hasAnyTokens({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })) {
      const usage = evt.usage;
      if (usage && typeof usage === "object" && !Array.isArray(usage)) {
        const part = usageFromClaudeUsageObject(usage as Record<string, unknown>);
        inputTokens = part.inputTokens;
        outputTokens = part.outputTokens;
        cacheReadTokens = part.cacheReadTokens;
        cacheWriteTokens = part.cacheWriteTokens;
      }
    }

    if (costUsd == null && evt.total_cost_usd != null) {
      costUsd = costFromUnknown(evt.total_cost_usd);
    } else if (costUsd == null && evt.costUSD != null) {
      costUsd = costFromUnknown(evt.costUSD);
    }

    const summary: TaskUsageSummary = {
      provider: "claude",
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
    };
    if (hasAnyTokens(summary) || summary.costUsd != null) best = summary;
  }

  return best;
}

export function extractTaskUsageFromLog(
  result: string,
  codingAgent?: string,
): TaskUsageSummary | null {
  const agent = String(codingAgent || "").trim().toLowerCase();
  // Claude-first MVP; other agents return null until parsers exist.
  if (!agent || agent === "claude" || agent.includes("claude")) {
    return extractClaudeUsageFromLog(result);
  }
  // Still try Claude-shaped JSONL — some logs are mixed / default to claude.
  return extractClaudeUsageFromLog(result);
}

export function formatUsageChip(u: TaskUsageSummary): { label: string; title: string } {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return String(n);
  };
  const parts: string[] = [];
  if (u.inputTokens) parts.push(`${fmt(u.inputTokens)} in`);
  if (u.outputTokens) parts.push(`${fmt(u.outputTokens)} out`);
  if (u.costUsd != null && u.costUsd > 0) {
    parts.push(u.costUsd < 0.01 ? `$${u.costUsd.toFixed(4)}` : `$${u.costUsd.toFixed(2)}`);
  }
  const label = parts.length ? parts.join(" · ") : "用量";
  const titleBits = [
    `input ${u.inputTokens}`,
    `output ${u.outputTokens}`,
    u.cacheReadTokens ? `cache read ${u.cacheReadTokens}` : "",
    u.cacheWriteTokens ? `cache write ${u.cacheWriteTokens}` : "",
    u.costUsd != null ? `cost $${u.costUsd}` : "",
  ].filter(Boolean);
  return { label, title: titleBits.join(" · ") };
}
