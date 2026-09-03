import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTOPILOT_WEBHOOK_MAX_BYTES = 256 * 1024;
export const AUTOPILOT_WEBHOOK_PROMPT_JSON_MAX = 16_000;

/** GitHub-style `X-Hub-Signature-256: sha256=<hex>`. */
export function verifyHubSignature256(
  rawBody: string,
  secret: string,
  header: string | undefined,
): boolean {
  const sig = String(header || "").trim();
  if (!secret || !sig.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function resolveWebhookDeliveryKey(headers: Record<string, unknown>): string {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = headers[k] ?? headers[k.toLowerCase()];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
      if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) {
        return v[0].trim().slice(0, 200);
      }
    }
    return "";
  };
  return (
    pick("idempotency-key", "Idempotency-Key") ||
    pick("x-github-delivery", "X-GitHub-Delivery") ||
    pick("x-delivery-id", "X-Delivery-Id") ||
    ""
  );
}

/** Build the markdown block appended to the runbook (not including runbook itself). */
export function formatWebhookPayloadBlock(payload: unknown): string {
  let json = "";
  try {
    json = JSON.stringify(payload ?? {}, null, 2);
  } catch {
    json = String(payload ?? "");
  }
  if (json.length > AUTOPILOT_WEBHOOK_PROMPT_JSON_MAX) {
    json = `${json.slice(0, AUTOPILOT_WEBHOOK_PROMPT_JSON_MAX)}\n…(truncated)`;
  }
  return `## Webhook payload\n\n\`\`\`json\n${json}\n\`\`\``;
}

export function headerString(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}
