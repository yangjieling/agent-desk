/**
 * Smoke test for work-item assign + @mention parsing (no HTTP server).
 * Run: node scripts/smoke-work-item-assign.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { newAgentId, newWorkItemId } = await import(path.join(root, "packages/core/dist/index.js"));
const { openDb } = await import(path.join(root, "packages/db/dist/index.js"));
const {
  parseAgentMentions,
  assignWorkItem,
  triggerMentionRuns,
  findActiveTaskForAgent,
} = await import(path.join(root, "packages/server/dist/work-item-dispatch.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-wi-assign-"));
const db = openDb(tmp);
const now = Date.now();

const agentA = {
  id: newAgentId(),
  name: "Reviewer Alpha",
  provider: "claude",
  model: "",
  defaultSkill: "default",
  skills: [],
  instructions: "",
  createdAt: now,
  updatedAt: now + 2,
};
const agentB = {
  id: newAgentId(),
  name: "Reviewer Beta",
  provider: "codex",
  model: "",
  defaultSkill: "default",
  skills: [],
  instructions: "",
  createdAt: now,
  updatedAt: now + 2,
};
db.upsertAgent(agentA);
db.upsertAgent(agentB);

const mentions = parseAgentMentions(
  `请看一下 @Reviewer Alpha 和 [@Reviewer Beta](mention://agent/${agentB.id})，以及 @${agentA.id}`,
  [agentA, agentB],
);
if (mentions.length !== 2) throw new Error(`expected 2 mentions, got ${mentions.length}`);
if (!mentions.some((m) => m.agentProfileId === agentA.id)) throw new Error("missing agentA");
if (!mentions.some((m) => m.agentProfileId === agentB.id)) throw new Error("missing agentB");
console.log("ok parse mentions");

const noWake = parseAgentMentions("只是笔记，没有人", [agentA, agentB]);
if (noWake.length) throw new Error("false positive mention");
console.log("ok no false positive");

const item = {
  id: newWorkItemId(),
  title: "Fix login",
  description: "Users cannot sign in",
  status: "open",
  projectDir: tmp,
  issueProvider: "",
  issueCode: "",
  agentProfileId: "",
  createdAt: now,
  updatedAt: now,
  lastActivityAt: now,
};
db.upsertWorkItem(item);

const runnerOpts = { db, dataDir: tmp };

const assigned = assignWorkItem(db, runnerOpts, item.id, {
  agentProfileId: agentA.id,
  start: true,
  note: "请优先修登录",
});
if (!assigned.started || !assigned.task) throw new Error("assign should start");
if (assigned.workItem.agentProfileId !== agentA.id) throw new Error("assignee not set");
const events = db.listWorkItemEvents(item.id, 20);
if (!events.some((e) => e.kind === "system" && e.body.includes("分配给"))) {
  throw new Error("missing assign system event");
}
console.log("ok assign starts task", assigned.task.id);

const again = assignWorkItem(db, runnerOpts, item.id, {
  agentProfileId: agentA.id,
  start: true,
});
if (!again.coalesced || again.started) throw new Error("same agent should coalesce");
console.log("ok assign coalesce");

const active = findActiveTaskForAgent(db, item.id, agentA.id);
if (!active) throw new Error("active task missing");

db.addWorkItemEvent({
  workItemId: item.id,
  kind: "note",
  author: "user",
  body: `跟进一下 @${agentB.name}`,
});
const triggered = triggerMentionRuns(db, runnerOpts, db.getWorkItem(item.id), `跟进一下 @${agentB.name}`);
if (triggered.mentions.length !== 1 || triggered.started.length !== 1) {
  throw new Error("mention should start agentB once");
}
if (db.getWorkItem(item.id).agentProfileId !== agentA.id) {
  throw new Error("mention must not change assignee");
}
console.log("ok mention starts other agent");

const suppressed = triggerMentionRuns(
  db,
  runnerOpts,
  db.getWorkItem(item.id),
  `@${agentB.name} again`,
  { wake: false },
);
if (suppressed.started.length || suppressed.mentions.length) {
  throw new Error("wake:false should skip");
}
console.log("ok wake suppressed");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("smoke-work-item-assign ok");
