#!/usr/bin/env node
/**
 * Import selected hb-cli / .joycode skills into agent-desk templates/skill-seeds
 * (user-seed packs, removable). Built-in triage/fix/test stay in templates/skills.
 *
 * Usage (from agent-desk root):
 *   node scripts/import-hb-skills.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEST = path.join(ROOT, "templates", "skill-seeds");
const BUILTIN = path.join(ROOT, "templates", "skills");
const SRC =
  process.env.HB_PROJECT_SKILLS_DIR ||
  path.resolve(ROOT, "../quality-shipyard/.joycode/skills");

/** hb-cli coding packs → user seeds (not CLI-managed). */
const IMPORT = [
  { id: "bug-fix", version: "1.0.9", desc: "缺陷修复全流程" },
  { id: "bug-fix-report", version: "1.0.0", desc: "缺陷修复报告生成" },
  { id: "api-selftest", version: "1.0.0", desc: "编码完成后的接口自测桥接" },
  { id: "code-merge", version: "1.0.0", desc: "审查后合并到主干或创建 PR" },
  { id: "code-review", version: "1.0.0", desc: "代码审查(可选对照需求)" },
  { id: "coding-impl", version: "1.0.0", desc: "按任务文件编码实现" },
  { id: "function-test", version: "1.0.0", desc: "单分支改动的功能测试执行与验证报告" },
];

const IGNORE = new Set([
  ".DS_Store",
  "joyme.json",
  "__pycache__",
  ".git",
  ".harness",
]);

const HARNESS_PREAMBLE = /<!--\s*HARNESS:PREAMBLE:START\s-->[\s\S]*?<!--\s*HARNESS:PREAMBLE:END\s-->/gi;
const USAGE_CURL =
  /\*\*CRITICAL:[^*]*\*+[\s\S]*?```bash[\s\S]*?11\.138\.45\.148[\s\S]*?```\s*/gi;
const USAGE_CURL2 =
  /```bash\s*\nSKILL_NAME=[\s\S]*?11\.138\.45\.148[\s\S]*?```\s*/gi;

function shouldIgnore(name) {
  if (IGNORE.has(name)) return true;
  if (name.endsWith(".pyc") || name.endsWith(".pyo")) return true;
  return false;
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldIgnore(ent.name)) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "__pycache__" || ent.name === ".harness") continue;
      copyTree(from, to);
    } else if (ent.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function ensureVersionFrontmatter(raw, version) {
  let text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return `---\nversion: ${version}\n---\n\n${text}`;
  }
  const nl = text.indexOf("\n");
  const end = text.indexOf("\n---", nl);
  if (end < 0) return text;
  let fm = text.slice(nl + 1, end);
  const body = text.slice(end + 4).replace(/^\n/, "");
  if (/^version\s*:/m.test(fm)) {
    fm = fm.replace(/^version\s*:.*$/m, `version: ${version}`);
  } else {
    fm = `version: ${version}\n${fm}`;
  }
  return `---\n${fm.trim()}\n---\n\n${body}`;
}

function sanitizeSkillMd(raw, version) {
  let text = raw;
  text = text.replace(HARNESS_PREAMBLE, "");
  text = text.replace(USAGE_CURL, "");
  text = text.replace(USAGE_CURL2, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return ensureVersionFrontmatter(text.trim() + "\n", version);
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[error] source skills dir not found: ${SRC}`);
    process.exit(1);
  }

  fs.mkdirSync(DEST, { recursive: true });
  for (const item of IMPORT) {
    const from = path.join(SRC, item.id);
    if (!fs.existsSync(path.join(from, "SKILL.md"))) {
      console.warn(`[skip] missing SKILL.md: ${item.id}`);
      continue;
    }
    const to = path.join(DEST, item.id);
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
    // Ensure not left under built-in templates/skills
    const builtinCopy = path.join(BUILTIN, item.id);
    if (fs.existsSync(builtinCopy)) fs.rmSync(builtinCopy, { recursive: true, force: true });
    copyTree(from, to);
    const skillMd = path.join(to, "SKILL.md");
    fs.writeFileSync(skillMd, sanitizeSkillMd(fs.readFileSync(skillMd, "utf8"), item.version), "utf8");
    console.log(`  + seed ${item.id}@${item.version}`);
  }

  for (const demo of [
    { id: "triage", version: "0.1.0" },
    { id: "fix", version: "0.1.0" },
    { id: "test", version: "0.1.0" },
  ]) {
    const skillMd = path.join(BUILTIN, demo.id, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    fs.writeFileSync(
      skillMd,
      ensureVersionFrontmatter(fs.readFileSync(skillMd, "utf8"), demo.version),
      "utf8",
    );
  }

  const seedManifest = {
    seedVersion: "0.3.0",
    updatedAt: new Date().toISOString(),
    note: "hb-cli coding packs → user seeds (removable). Not CLI-managed.",
    skills: IMPORT,
  };
  fs.writeFileSync(path.join(DEST, "manifest.json"), JSON.stringify(seedManifest, null, 2) + "\n");

  const builtinManifest = {
    bundleVersion: "0.3.0",
    updatedAt: new Date().toISOString(),
    note: "Built-in skills shipped with CLI (managed install/update).",
    skills: [
      { id: "triage", version: "0.1.0", desc: "分诊并打开 Triage 闸门" },
      { id: "fix", version: "0.1.0", desc: "实现确认后的修复" },
      { id: "test", version: "0.1.0", desc: "验证修复结果" },
    ],
  };
  fs.writeFileSync(path.join(BUILTIN, "manifest.json"), JSON.stringify(builtinManifest, null, 2) + "\n");

  console.log(`[ok] seeds → ${DEST}; builtin → ${BUILTIN}`);
}

main();
