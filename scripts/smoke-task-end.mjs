/**
 * Smoke: host task-end marker priority + protocol helpers.
 * Run: node scripts/smoke-task-end.mjs (after packages/core build)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  containsTaskEndMarker,
  enrichResumePromptBody,
  looksLikeRatingReply,
  looksLikeTaskEndReply,
  PREFERRED_TASK_END_MARKER,
  resolveTaskStatusAfterRun,
  synthesizeServiceRatingGate,
  taskEndRules,
} = await import(path.join(root, "packages/core/dist/index.js"));

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// Marker detection: line-anchored + substring fallback
assert(containsTaskEndMarker("## oh-task-end\n谢谢"), "line marker");
assert(containsTaskEndMarker("## hb-task-end"), "legacy marker");
assert(containsTaskEndMarker("done ## oh-task-end thanks"), "inline fallback");
assert(!containsTaskEndMarker("no end here"), "no false positive");

// task_end wins over open gate in same output
{
  const out = [
    "some work",
    "## 闸门「后续」",
    "## oh-choices",
    "- 继续|继续",
    "",
    "## oh-task-end",
    "再见",
  ].join("\n");
  const r = resolveTaskStatusAfterRun(out, 0, false);
  assert(r.status === "done" && r.reason === "task_end", `expected task_end done, got ${JSON.stringify(r)}`);
}

// open gate without end → awaiting
{
  const out = ["## 闸门「确认」", "## oh-choices", "- 确认|ok"].join("\n");
  const r = resolveTaskStatusAfterRun(out, 0, false);
  assert(r.status === "awaiting" && r.reason === "open_gate", `expected open_gate, got ${JSON.stringify(r)}`);
}

// plain done
{
  const r = resolveTaskStatusAfterRun("全部改完了。", 0, false);
  assert(r.status === "done" && r.reason === "plain_done", `expected plain_done, got ${JSON.stringify(r)}`);
}

assert(looksLikeTaskEndReply("结束"), "end reply");
assert(looksLikeTaskEndReply("done"), "done reply");
assert(!looksLikeTaskEndReply("继续修"), "not end");
assert(looksLikeRatingReply("好"), "rating");
assert(looksLikeRatingReply("还可以"), "rating mid");

const rules = taskEndRules();
assert(rules.includes(PREFERRED_TASK_END_MARKER), "rules mention preferred marker");
assert(rules.includes("## oh-choices"), "rules mention oh-choices");

const resume = enrichResumePromptBody("结束");
assert(resume.includes(PREFERRED_TASK_END_MARKER), "resume end emphasis");
assert(resume.includes("收口提醒"), "resume end nudge");

const ratingResume = enrichResumePromptBody("好");
assert(ratingResume.includes("服务评价"), "rating resume nudge");

const gate = synthesizeServiceRatingGate();
assert(gate.includes("## 闸门「服务评价」"), "synth gate heading");
assert(gate.includes("## oh-choices"), "synth choices");

console.log("smoke-task-end: ok");
