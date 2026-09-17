/**
 * Structured Shared Context for workflow orchestration.
 * Persisted on WorkflowRun; dual-read string | object for backward compatibility.
 */

export interface SharedContextStep {
  nodeId: string;
  skill: string;
  title: string;
  summary: string;
  at: number;
}

export interface SharedContextV1 {
  version: 1;
  goal: string;
  currentState: string;
  conclusions: string[];
  changedFiles: string[];
  errors: string[];
  completedSteps: SharedContextStep[];
  nextSteps: string[];
  /** Legacy blob from older runs (string sharedContext). */
  legacyText?: string;
}

export type SharedContextInput = string | SharedContextV1 | null | undefined;

const SUMMARY_MAX = 800;
const PROMPT_CTX_MAX = 3500;

export function emptySharedContext(seed?: { goal?: string }): SharedContextV1 {
  return {
    version: 1,
    goal: (seed?.goal || "").trim(),
    currentState: "",
    conclusions: [],
    changedFiles: [],
    errors: [],
    completedSteps: [],
    nextSteps: [],
  };
}

export function isSharedContextV1(value: unknown): value is SharedContextV1 {
  return Boolean(value && typeof value === "object" && (value as SharedContextV1).version === 1);
}

/** Normalize on-disk / in-memory sharedContext to V1. */
export function normalizeSharedContext(
  raw: SharedContextInput,
  seed?: { goal?: string },
): SharedContextV1 {
  if (isSharedContextV1(raw)) {
    const ctx: SharedContextV1 = {
      version: 1,
      goal: String(raw.goal ?? seed?.goal ?? "").trim(),
      currentState: String(raw.currentState ?? "").trim(),
      conclusions: Array.isArray(raw.conclusions)
        ? raw.conclusions.map((s) => String(s).trim()).filter(Boolean)
        : [],
      changedFiles: Array.isArray(raw.changedFiles)
        ? raw.changedFiles.map((s) => String(s).trim()).filter(Boolean)
        : [],
      errors: Array.isArray(raw.errors)
        ? raw.errors.map((s) => String(s).trim()).filter(Boolean)
        : [],
      completedSteps: Array.isArray(raw.completedSteps)
        ? raw.completedSteps.map((s) => ({
            nodeId: String(s?.nodeId ?? ""),
            skill: String(s?.skill ?? ""),
            title: String(s?.title ?? ""),
            summary: String(s?.summary ?? ""),
            at: Number(s?.at ?? 0) || 0,
          }))
        : [],
      nextSteps: Array.isArray(raw.nextSteps)
        ? raw.nextSteps.map((s) => String(s).trim()).filter(Boolean)
        : [],
    };
    if (raw.legacyText) ctx.legacyText = String(raw.legacyText);
    if (!ctx.goal && seed?.goal) ctx.goal = seed.goal.trim();
    return ctx;
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  const ctx = emptySharedContext(seed);
  if (text) ctx.legacyText = text;
  return ctx;
}

export function summarizeStepResult(result: string): string {
  const text = (result || "").trim();
  if (!text) return "";
  // Drop noisy activity / command prefixes when possible.
  const lines = text.split(/\r?\n/).filter((ln) => {
    const t = ln.trim();
    if (!t) return false;
    if (/^\[[\d\- :.]+\]\s*\$/.test(t)) return false;
    if (/^\[[\d\- :.]+\]\s*(runtime|prompt|cli|workspace)\b/i.test(t)) return false;
    return true;
  });
  const cleaned = (lines.length ? lines.join("\n") : text).trim();
  if (cleaned.length <= SUMMARY_MAX) return cleaned;
  return `…${cleaned.slice(-SUMMARY_MAX)}`;
}

export function extractChangedFilesHint(result: string): string[] {
  const files = new Set<string>();
  const text = result || "";
  const patterns = [
    /(?:Wrote|Updated|Modified|Created|Deleted|Edit(?:ed)?)\s+[`'"]?([^\s`'"\]]+\.[\w.+-]+)/gi,
    /(?:write|edit|create)\s+(?:file\s+)?[`'"]([^`'"]+)[`'"]/gi,
    /diff --git a\/([^\s]+) b\//g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const p = (m[1] || "").trim();
      if (p && p.length < 240 && !p.includes("\n")) files.add(p);
      if (files.size >= 24) break;
    }
  }
  return [...files];
}

export function appendStepToSharedContext(
  raw: SharedContextInput,
  input: {
    nodeId: string;
    skill: string;
    title: string;
    result: string;
    failed?: boolean;
    nextStepTitles?: string[];
  },
): SharedContextV1 {
  const ctx = normalizeSharedContext(raw);
  const summary = summarizeStepResult(input.result);
  const label = (input.title || input.skill || "step").trim();
  ctx.completedSteps.push({
    nodeId: input.nodeId || "",
    skill: input.skill || "",
    title: label,
    summary: input.failed ? `[failed] ${summary}` : summary,
    at: Date.now(),
  });
  if (input.failed && summary) {
    ctx.errors.push(`${label}: ${summary.slice(0, 240)}`);
  } else if (summary) {
    // Keep a short rolling "current state" from the latest success.
    ctx.currentState = summary.slice(0, 400);
  }
  for (const f of extractChangedFilesHint(input.result)) {
    if (!ctx.changedFiles.includes(f)) ctx.changedFiles.push(f);
  }
  if (input.nextStepTitles) {
    ctx.nextSteps = input.nextStepTitles.map((s) => s.trim()).filter(Boolean);
  }
  // Keep legacyText in sync for old readers / debugging.
  ctx.legacyText = formatSharedContextForPrompt(ctx, { maxLen: 12_000 });
  return ctx;
}

/** Compact prompt injection; prefers structured sections. */
export function formatSharedContextForPrompt(
  raw: SharedContextInput,
  opts?: { maxLen?: number; compact?: boolean },
): string {
  const ctx = normalizeSharedContext(raw);
  const maxLen = opts?.maxLen ?? PROMPT_CTX_MAX;
  const parts: string[] = [];
  if (ctx.goal) parts.push(`目标: ${ctx.goal}`);
  if (ctx.currentState) parts.push(`当前状态: ${ctx.currentState}`);
  if (ctx.conclusions.length) {
    parts.push(`结论:\n${ctx.conclusions.map((c) => `- ${c}`).join("\n")}`);
  }
  if (ctx.changedFiles.length) {
    parts.push(`变更文件:\n${ctx.changedFiles.map((f) => `- ${f}`).join("\n")}`);
  }
  if (ctx.errors.length) {
    parts.push(`错误:\n${ctx.errors.slice(-5).map((e) => `- ${e}`).join("\n")}`);
  }
  const steps = opts?.compact ? ctx.completedSteps.slice(-2) : ctx.completedSteps.slice(-6);
  if (steps.length) {
    parts.push(
      `已完成步骤:\n${steps
        .map((s) => {
          const head = `- ${s.title || s.skill}${s.skill && s.title !== s.skill ? ` (${s.skill})` : ""}`;
          const body = (s.summary || "").trim();
          return body ? `${head}\n  ${body.replace(/\n/g, "\n  ").slice(0, 400)}` : head;
        })
        .join("\n")}`,
    );
  } else if (ctx.legacyText) {
    parts.push(`前序上下文:\n${ctx.legacyText}`);
  }
  if (ctx.nextSteps.length) {
    parts.push(`下一步:\n${ctx.nextSteps.map((s) => `- ${s}`).join("\n")}`);
  }
  let out = parts.join("\n\n").trim();
  if (out.length > maxLen) out = `…${out.slice(-maxLen)}`;
  return out;
}

export function sharedContextHasContent(raw: SharedContextInput): boolean {
  const ctx = normalizeSharedContext(raw);
  return Boolean(
    ctx.goal ||
      ctx.currentState ||
      ctx.conclusions.length ||
      ctx.changedFiles.length ||
      ctx.errors.length ||
      ctx.completedSteps.length ||
      ctx.nextSteps.length ||
      (ctx.legacyText || "").trim(),
  );
}
