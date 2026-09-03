/**
 * Smoke test for #3 claim + heartbeat lease (no agent CLI required).
 * Run: node --experimental-strip-types scripts/smoke-executor-claim.mts
 * Or after build: node scripts/smoke-executor-claim.mjs (this file uses dist imports).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { openDb } = await import(path.join(root, "packages/db/dist/index.js"));
const { newTaskId } = await import(path.join(root, "packages/core/dist/index.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-claim-"));
const db = openDb(tmp);

const now = Date.now();
const task = {
  id: newTaskId(),
  taskType: "skill",
  status: "queued",
  skill: "default",
  workflowId: "",
  workflowRunId: "",
  workflowName: "",
  workflowMode: "",
  workflowStep: 0,
  workflowStepTotal: 0,
  parentTaskId: "",
  workflowNodeIndex: null,
  projectDir: tmp,
  workItemId: "",
  issueCode: "",
  title: "claim smoke",
  prompt: "noop",
  agentProfileId: "",
  codingAgent: "claude",
  model: "",
  sessionId: "",
  result: "",
  gateNotifyHash: "",
  retryCount: 0,
  failureCode: "",
  failureMessage: "",
  nextRetryAt: 0,
  claimToken: "",
  claimedBy: "",
  claimedAt: 0,
  heartbeatAt: 0,
  createdAt: now,
  updatedAt: now,
  lastActivityAt: now,
};
db.upsertTask(task);

const claimed = db.claimNextQueuedTask({
  executorId: "smoke-exec",
  claimToken: "tok-1",
  workspaceLockEnabled: true,
});
if (!claimed || claimed.status !== "dispatched" || claimed.claimedBy !== "smoke-exec") {
  throw new Error(`claim failed: ${JSON.stringify(claimed)}`);
}
console.log("ok claim →", claimed.id, claimed.status);

const hb = db.heartbeatTaskClaim(claimed.id, "tok-1", "smoke-exec");
if (!hb) throw new Error("heartbeat failed");
console.log("ok heartbeat");

// Stale reclaim: force old heartbeat
db.updateTask(claimed.id, { heartbeatAt: Date.now() - 120_000 });
const reclaimed = db.reclaimStaleDispatchedClaims(45_000);
if (!reclaimed.length || reclaimed[0].status !== "queued") {
  throw new Error(`reclaim failed: ${JSON.stringify(reclaimed)}`);
}
console.log("ok reclaim →", reclaimed[0].status, reclaimed[0].failureCode);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("smoke-executor-claim: PASS");
