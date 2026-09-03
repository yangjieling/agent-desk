/**
 * Smoke: normalizeAgentSkills + mountSkills merge.
 * Run: node scripts/smoke-agent-skills.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { normalizeAgentSkills } = await import(path.join(root, "packages/core/dist/index.js"));
const { mountSkills } = await import(path.join(root, "packages/skills/dist/index.js"));

const cleaned = normalizeAgentSkills(["fix", "default", "fix", "", " triage ", "test"]);
if (cleaned.join(",") !== "fix,triage,test") {
  throw new Error(`normalize: ${cleaned.join(",")}`);
}
console.log("ok normalizeAgentSkills");

const mount = mountSkills("fix", ["test", "fix", "default"], {
  bundledDir: path.join(root, "templates/skills"),
});
if (mount.skillId !== "fix") throw new Error(`primary skill ${mount.skillId}`);
if (!mount.promptPrefix.includes("fix")) throw new Error("missing fix prompt");
if (!mount.promptPrefix.includes("test")) throw new Error("missing extra test prompt");
if (!mount.extraSkillDirs.length) throw new Error("expected skill dirs");
console.log("ok mountSkills", mount.extraSkillDirs.length, "dirs");

console.log("smoke-agent-skills ok");
