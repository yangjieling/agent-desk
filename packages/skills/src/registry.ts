import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillDescriptor, SkillLookupOptions, SkillSource } from "./types.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSkillId(raw: string): string {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isValidSkillId(id: string): boolean {
  return NAME_RE.test(id);
}

export function userSkillsDir(override?: string): string {
  if (override?.trim()) return path.resolve(override.trim());
  const data = (process.env.AD_DATA_DIR || "").trim();
  if (data) return path.join(path.resolve(data), "skills");
  return path.join(os.homedir(), ".agent-desk", "skills");
}

export function defaultBundledSkillsDir(override?: string): string {
  if (override?.trim()) return path.resolve(override.trim());
  const env = (process.env.AD_BUNDLED_SKILL_DIR || "").trim();
  if (env) return path.resolve(env);
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/skills/dist → ../../../templates/skills
  return path.resolve(here, "../../../templates/skills");
}

/** Nearest ancestor with `.git`, else cwd. */
export function findProjectRoot(cwd: string): string {
  let cur = path.resolve(cwd || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(cwd || process.cwd());
    cur = parent;
  }
}

export interface SkillRoot {
  source: SkillSource;
  dir: string;
  /** Lower wins when merging duplicates. */
  rank: number;
}

export function skillRoots(opts: SkillLookupOptions = {}): SkillRoot[] {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const project = findProjectRoot(cwd);
  const roots: SkillRoot[] = [
    { source: "project-agent-desk", dir: path.join(project, ".agent-desk", "skills"), rank: 100 },
    { source: "project-agents", dir: path.join(project, ".agents", "skills"), rank: 200 },
  ];

  const custom = [
    ...(opts.extraDirs || []),
    ...((process.env.AD_SKILL_DIRS || "").split(/[:;]/).map((s) => s.trim()).filter(Boolean)),
  ];
  for (const d of custom) {
    roots.push({ source: "custom", dir: path.resolve(d), rank: 300 });
  }

  roots.push({
    source: "user",
    dir: userSkillsDir(opts.userDir),
    rank: 400,
  });
  roots.push({
    source: "bundled",
    dir: defaultBundledSkillsDir(opts.bundledDir),
    rank: 600,
  });

  return roots;
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Minimal YAML frontmatter: `key: value` lines + folded `>` / `>-` / `|` blocks. */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { meta: {}, body: text };
  const nl = text.indexOf("\n");
  if (nl < 0) return { meta: {}, body: text };
  const end = text.indexOf("\n---", nl);
  if (end < 0) return { meta: {}, body: text };
  const fm = text.slice(nl + 1, end);
  let body = text.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  const meta: Record<string, string> = {};
  const lines = fm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let v = m[2].trim();
    if (v === ">" || v === ">-" || v === "|" || v === "|-") {
      const block: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (/^\s/.test(next) || next.trim() === "") {
          i += 1;
          block.push(next.replace(/^\s{2}/, "").trimEnd());
          continue;
        }
        break;
      }
      v = block.join(v.startsWith("|") ? "\n" : " ").replace(/\s+/g, " ").trim();
    } else if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    meta[key] = v;
  }
  return { meta, body };
}

function listScripts(dir: string): string[] {
  const scriptsDir = path.join(dir, "scripts");
  if (!fs.existsSync(scriptsDir)) return [];
  try {
    return fs
      .readdirSync(scriptsDir)
      .filter((n) => /\.(py|sh|js|mjs|ts)$/i.test(n))
      .map((n) => path.join(scriptsDir, n))
      .filter((p) => fs.statSync(p).isFile())
      .sort();
  } catch {
    return [];
  }
}

function readInstallMeta(dir: string | null): { managed: boolean; version?: string } | null {
  if (!dir) return null;
  try {
    const raw = fs.readFileSync(path.join(dir, ".ad-skill-meta.json"), "utf8");
    const meta = JSON.parse(raw) as { managed?: boolean; version?: string };
    return { managed: !!meta.managed, version: meta.version };
  } catch {
    return null;
  }
}

function loadFromFile(
  file: string,
  fallbackId: string,
  rootSource: SkillSource,
  bundleDir: string | null,
): SkillDescriptor | null {
  const raw = readText(file);
  if (!raw.trim()) return null;
  const { meta, body } = parseFrontmatter(raw);
  // Prefer directory / file stem as stable id (matches hb-cli install names).
  const id =
    normalizeSkillId(fallbackId) || normalizeSkillId(meta.name || "") || "";
  if (!id) return null;
  const name = (meta.name || fallbackId).trim() || id;
  const description = (meta.description || "").trim();
  const instructions = stripHarnessNoise(body).trim();
  const install = readInstallMeta(bundleDir);
  // Managed copies live under the user skills dir but are still "bundled" (内置).
  const managed = rootSource === "bundled" || !!install?.managed;
  const source: SkillSource =
    rootSource === "user" && install?.managed ? "bundled" : rootSource;
  const removable = rootSource === "user" && !install?.managed;
  return {
    id,
    name,
    description,
    instructions,
    path: file,
    dir: bundleDir,
    source,
    scripts: bundleDir ? listScripts(bundleDir) : [],
    managed,
    removable,
    version: install?.version || (meta.version || "").trim() || undefined,
  };
}

const HARNESS_PREAMBLE =
  /<!--\s*HARNESS:PREAMBLE:START\s-->[\s\S]*?<!--\s*HARNESS:PREAMBLE:END\s-->/gi;

function stripHarnessNoise(text: string): string {
  return (text || "")
    .replace(HARNESS_PREAMBLE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function scanRoot(root: SkillRoot): SkillDescriptor[] {
  if (!fs.existsSync(root.dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root.dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SkillDescriptor[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    if (ent.name === "manifest.json") continue;
    if (ent.isDirectory()) {
      const skillMd = path.join(root.dir, ent.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const desc = loadFromFile(
        skillMd,
        ent.name,
        root.source,
        path.join(root.dir, ent.name),
      );
      if (desc) out.push(desc);
      continue;
    }
    if (ent.isFile() && ent.name.endsWith(".md") && ent.name !== "SKILL.md") {
      const stem = ent.name.slice(0, -3);
      const desc = loadFromFile(
        path.join(root.dir, ent.name),
        stem,
        root.source,
        null,
      );
      if (desc) out.push(desc);
    }
  }
  return out;
}

/**
 * Discover skills. Same id: lower rank (project) wins over user/bundled.
 */
export function listSkillDescriptors(opts: SkillLookupOptions = {}): SkillDescriptor[] {
  const byId = new Map<string, { rank: number; skill: SkillDescriptor }>();
  for (const root of skillRoots(opts)) {
    for (const skill of scanRoot(root)) {
      const prev = byId.get(skill.id);
      if (!prev || root.rank < prev.rank) {
        byId.set(skill.id, { rank: root.rank, skill });
      }
    }
  }
  return [...byId.values()]
    .map((x) => x.skill)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveSkill(
  id: string,
  opts: SkillLookupOptions = {},
): SkillDescriptor | null {
  const want = normalizeSkillId(id);
  if (!want || want === "default") return null;
  return listSkillDescriptors(opts).find((s) => s.id === want) ?? null;
}
