/**
 * Smoke test for Autopilot webhook HMAC + idempotency (no HTTP server).
 * Run: node scripts/smoke-autopilot-webhook.mjs
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await import(path.join(root, "packages/core/dist/index.js"));
const { openDb } = await import(path.join(root, "packages/db/dist/index.js"));
const {
  verifyHubSignature256,
  resolveWebhookDeliveryKey,
  formatWebhookPayloadBlock,
} = await import(path.join(root, "packages/server/dist/autopilot-webhook.js"));
const { newAutopilotId, newAutopilotWebhookSecret, newAutopilotWebhookToken } =
  await import(path.join(root, "packages/core/dist/index.js"));

const secret = newAutopilotWebhookSecret();
const body = JSON.stringify({ event: "ping", n: 1 });
const sig = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
if (!verifyHubSignature256(body, secret, sig)) throw new Error("HMAC verify failed");
if (verifyHubSignature256(body, secret, "sha256=deadbeef")) {
  throw new Error("HMAC should reject bad sig");
}
console.log("ok hmac");

const key = resolveWebhookDeliveryKey({
  "Idempotency-Key": "deliv-1",
  "x-github-delivery": "gh-should-not-win",
});
if (key !== "deliv-1") throw new Error(`delivery key: ${key}`);
console.log("ok delivery key");

const block = formatWebhookPayloadBlock({ hello: "world" });
if (!block.includes("Webhook payload") || !block.includes('"hello"')) {
  throw new Error("payload block");
}
console.log("ok payload block");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-apwh-"));
const db = openDb(tmp);
const now = Date.now();
const apId = newAutopilotId();
db.upsertAutopilot({
  id: apId,
  name: "wh-smoke",
  runbook: "ping",
  status: "active",
  action: "skill_task",
  executionMode: "run_only",
  skill: "default",
  workflowId: "",
  projectDir: tmp,
  agentProfileId: "",
  model: "",
  titleTemplate: "{{name}}",
  cronExpression: "0 9 * * *",
  timezone: "local",
  nextRunAt: 0,
  lastRunAt: 0,
  concurrencyPolicy: "skip",
  webhookEnabled: true,
  webhookToken: newAutopilotWebhookToken(),
  webhookSecret: secret,
  createdAt: now,
  updatedAt: now,
});

const first = db.tryInsertWebhookDelivery({
  autopilotId: apId,
  deliveryKey: "deliv-1",
  status: "accepted",
});
if (first.duplicate) throw new Error("first insert should not be duplicate");
const second = db.tryInsertWebhookDelivery({
  autopilotId: apId,
  deliveryKey: "deliv-1",
  status: "accepted",
});
if (!second.duplicate || second.id !== first.id) {
  throw new Error("second insert should be duplicate");
}
console.log("ok idempotent delivery");

const found = db.getAutopilotByWebhookToken(
  db.getAutopilot(apId)?.webhookToken || "",
);
if (!found || found.id !== apId) throw new Error("token lookup failed");
console.log("ok token lookup");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("smoke-autopilot-webhook: PASS");
