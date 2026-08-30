import type { DingTalkCardCallbackEvent } from "./stream.js";

const GATE_PREFIX = "ad-gate/";

/** Encode a gate card outTrackId that Stream callbacks can map back to a task. */
export function encodeGateOutTrackId(taskId: string, suffix = ""): string {
  const id = String(taskId || "").trim();
  if (!id) throw new Error("encodeGateOutTrackId: empty taskId");
  const stamp = Date.now().toString(36);
  const extra = suffix ? `/${suffix}` : "";
  // Keep under DingTalk's typical 100-char outTrackId budget.
  return `${GATE_PREFIX}${id}/${stamp}${extra}`.slice(0, 100);
}

/** Parse taskId from an agent-desk gate outTrackId. */
export function parseGateOutTrackId(outTrackId: string | undefined): string | null {
  const raw = String(outTrackId || "").trim();
  if (!raw.startsWith(GATE_PREFIX)) return null;
  const rest = raw.slice(GATE_PREFIX.length);
  const slash = rest.indexOf("/");
  const taskId = (slash >= 0 ? rest.slice(0, slash) : rest).trim();
  return taskId || null;
}

/** Prefer params.reply; fall back to first non-empty string param. */
export function replyFromCardCallback(event: DingTalkCardCallbackEvent): string {
  const reply = event.params.reply;
  if (typeof reply === "string" && reply.trim()) return reply.trim();
  if (reply != null && typeof reply !== "object") {
    const s = String(reply).trim();
    if (s) return s;
  }
  for (const [key, value] of Object.entries(event.params)) {
    if (key === "actionId" || key === "actionIds") continue;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const action = event.actionIds[0];
  return action ? String(action) : "";
}
