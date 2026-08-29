import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultBundledSkillsDir, userSkillsDir } from "./registry.js";

export const SKILL_META_FILE = ".ad-skill-meta.json";

export interface BundledSkillEntry {
  id: string;
  version: string;
  desc?: string;
}

export interface SkillsManifest {
  bundleVersion: string;
  updatedAt?: string;
  note?: string;
  skills: BundledSkillEntry[];
}

export interface SkillSeedsManifest {
  seedVersion: string;
  updatedAt?: string;
  note?: string;
  skills: BundledSkillEntry[];
}

export interface SkillInstallMeta {
  id: string;
  version: string;
  managed: boolean;
  bundleVersion?: string;
  updatedAt: string;
}

export interface SyncSkillsOptions {
  force?: boolean;
  /** Only sync these ids (default: all in manifest). */
  ids?: string[];
  userDir?: string;
  bundledDir?: string;
  seedsDir?: string;
  /** When true, skip skills that look user-owned (no managed meta). Default true. */
  preserveUserOverrides?: boolean;
}

export interface SyncSkillsResult {
  bundleVersion: string;
  installed: string[];
  updated: string[];
  skipped: string[];
  errors: { id: string; error: string }[];
}

export interface SeedSkillsResult {
  seedVersion: string;
  seeded: string[];
  skipped: string[];
  demoted: string[];
  errors: { id: string; error: string }[];
}

export interface EnsureSkillsResult {
  sync: SyncSkillsResult | null;
  seed: SeedSkillsResult;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function defaultSkillSeedsDir(override?: string): string {
  if (override?.trim()) return path.resolve(override.trim());
  const env = (process.env.AD_SKILL_SEEDS_DIR || "").trim();
  if (env) return path.resolve(env);
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/skills/dist → ../../../templates/skill-seeds
  return path.resolve(here, "../../../templates/skill-seeds");
}

export function loadSkillsManifest(bundledDir?: string): SkillsManifest | null {
  const root = defaultBundledSkillsDir(bundledDir);
  const file = path.join(root, "manifest.json");
  const data = readJson<SkillsManifest>(file);
  if (!data || !Array.isArray(data.skills)) return null;
  return data;
}

export function loadSkillSeedsManifest(seedsDir?: string): SkillSeedsManifest | null {
  const root = defaultSkillSeedsDir(seedsDir);
  const file = path.join(root, "manifest.json");
  const data = readJson<SkillSeedsManifest>(file);
  if (!data || !Array.isArray(data.skills)) return null;
  return data;
}

/** Compare dotted versions; returns -1 / 0 / 1. Non-numeric segments → 0. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || "0")
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b || "0")
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function copySkillTree(src: string, dst: string): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (p) => {
      const base = path.basename(p);
      if (
        base === ".DS_Store" ||
        base === "__pycache__" ||
        base === "joyme.json" ||
        base === SKILL_META_FILE
      ) {
        return false;
      }
      if (base.endsWith(".pyc") || base.endsWith(".pyo")) return false;
      return true;
    },
  });
}

function writeMeta(dst: string, meta: SkillInstallMeta): void {
  fs.writeFileSync(path.join(dst, SKILL_META_FILE), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

function readMeta(dst: string): SkillInstallMeta | null {
  return readJson<SkillInstallMeta>(path.join(dst, SKILL_META_FILE));
}

function skillStampFile(userDir: string): string {
  return path.join(path.dirname(userDir), ".last-skill-bundle-version");
}

/**
 * Sync built-in templates/skills → ~/.agent-desk/skills (managed).
 * Only ids listed in templates/skills/manifest.json.
 */
export function syncBundledSkills(opts: SyncSkillsOptions = {}): SyncSkillsResult {
  const bundledDir = defaultBundledSkillsDir(opts.bundledDir);
  const userDir = userSkillsDir(opts.userDir);
  const manifest = loadSkillsManifest(bundledDir);
  const result: SyncSkillsResult = {
    bundleVersion: manifest?.bundleVersion || "0",
    installed: [],
    updated: [],
    skipped: [],
    errors: [],
  };

  if (!manifest) {
    result.errors.push({ id: "*", error: `manifest not found under ${bundledDir}` });
    return result;
  }

  fs.mkdirSync(userDir, { recursive: true });
  const want = new Set((opts.ids || []).map((s) => s.trim()).filter(Boolean));
  const entries = want.size
    ? manifest.skills.filter((s) => want.has(s.id))
    : manifest.skills;

  for (const entry of entries) {
    const id = entry.id;
    const src = path.join(bundledDir, id);
    const dst = path.join(userDir, id);
    try {
      if (!fs.existsSync(path.join(src, "SKILL.md"))) {
        result.errors.push({ id, error: "bundled SKILL.md missing" });
        continue;
      }
      const hasSkill = fs.existsSync(path.join(dst, "SKILL.md"));
      const meta = hasSkill ? readMeta(dst) : null;
      const preserve = opts.preserveUserOverrides !== false;

      if (hasSkill && !meta?.managed && preserve && !opts.force) {
        result.skipped.push(id);
        continue;
      }

      const installedVer = meta?.version || "";
      const needs =
        opts.force ||
        !hasSkill ||
        !installedVer ||
        compareVersions(installedVer, entry.version) < 0;

      if (!needs) {
        result.skipped.push(id);
        continue;
      }

      copySkillTree(src, dst);
      writeMeta(dst, {
        id,
        version: entry.version,
        managed: true,
        bundleVersion: manifest.bundleVersion,
        updatedAt: new Date().toISOString(),
      });
      if (hasSkill) result.updated.push(id);
      else result.installed.push(id);
    } catch (e) {
      result.errors.push({
        id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    fs.writeFileSync(skillStampFile(userDir), `${manifest.bundleVersion}\n`, "utf8");
  } catch {
    // ignore stamp failures
  }

  return result;
}

/** Sync when bundle version changed (or never stamped). Returns null if up to date. */
export function syncBundledSkillsIfNeeded(
  opts: Omit<SyncSkillsOptions, "force"> = {},
): SyncSkillsResult | null {
  const bundledDir = defaultBundledSkillsDir(opts.bundledDir);
  const userDir = userSkillsDir(opts.userDir);
  const manifest = loadSkillsManifest(bundledDir);
  if (!manifest) return null;
  const stamp = skillStampFile(userDir);
  let prev = "";
  try {
    prev = fs.readFileSync(stamp, "utf8").trim();
  } catch {
    prev = "";
  }
  if (prev === manifest.bundleVersion) {
    const missing = manifest.skills.some((s) => {
      const dst = path.join(userDir, s.id);
      return !fs.existsSync(path.join(dst, "SKILL.md"));
    });
    if (!missing) return null;
  }
  return syncBundledSkills(opts);
}

/**
 * Drop managed meta for skills no longer in the built-in manifest
 * (e.g. former hb-cli packs) so they become removable user skills.
 */
export function demoteFormerManagedSkills(opts: {
  userDir?: string;
  bundledDir?: string;
} = {}): string[] {
  const userDir = userSkillsDir(opts.userDir);
  const manifest = loadSkillsManifest(opts.bundledDir);
  const keep = new Set((manifest?.skills || []).map((s) => s.id));
  if (!fs.existsSync(userDir)) return [];
  const demoted: string[] = [];
  for (const ent of fs.readdirSync(userDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    if (keep.has(ent.name)) continue;
    const dst = path.join(userDir, ent.name);
    const meta = readMeta(dst);
    if (!meta?.managed) continue;
    try {
      fs.unlinkSync(path.join(dst, SKILL_META_FILE));
      demoted.push(ent.name);
    } catch {
      // ignore
    }
  }
  return demoted;
}

/**
 * One-time copy of templates/skill-seeds → user dir as **user** skills (no managed meta).
 * Never overwrites an existing install.
 */
export function seedUserSkills(opts: SyncSkillsOptions = {}): SeedSkillsResult {
  const seedsDir = defaultSkillSeedsDir(opts.seedsDir);
  const userDir = userSkillsDir(opts.userDir);
  const manifest = loadSkillSeedsManifest(seedsDir);
  const result: SeedSkillsResult = {
    seedVersion: manifest?.seedVersion || "0",
    seeded: [],
    skipped: [],
    demoted: demoteFormerManagedSkills({
      userDir: opts.userDir,
      bundledDir: opts.bundledDir,
    }),
    errors: [],
  };
  if (!manifest) return result;

  fs.mkdirSync(userDir, { recursive: true });
  for (const entry of manifest.skills) {
    const id = entry.id;
    const src = path.join(seedsDir, id);
    const dst = path.join(userDir, id);
    try {
      if (!fs.existsSync(path.join(src, "SKILL.md"))) {
        result.errors.push({ id, error: "seed SKILL.md missing" });
        continue;
      }
      if (fs.existsSync(path.join(dst, "SKILL.md"))) {
        result.skipped.push(id);
        continue;
      }
      copySkillTree(src, dst);
      // intentionally no .ad-skill-meta.json → user / removable
      result.seeded.push(id);
    } catch (e) {
      result.errors.push({
        id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}

/** Built-in sync (if needed) + seed user packs + demote former managed. */
export function ensureSkillsReady(
  opts: Omit<SyncSkillsOptions, "force"> = {},
): EnsureSkillsResult {
  const sync = syncBundledSkillsIfNeeded(opts);
  const seed = seedUserSkills(opts);
  return { sync, seed };
}

/**
 * Remove a user-authored skill from ~/.agent-desk/skills.
 * Built-in (managed) skills cannot be uninstalled — use sync to update them.
 */
export function uninstallUserSkill(
  skillId: string,
  opts: { userDir?: string } = {},
): { id: string; removed: string } {
  const id = String(skillId || "").trim();
  if (!id) throw new Error("skill id required");
  const userDir = userSkillsDir(opts.userDir);
  const dst = path.join(userDir, id);
  if (!fs.existsSync(path.join(dst, "SKILL.md")) && !fs.existsSync(dst)) {
    throw new Error(`skill not found in user dir: ${id}`);
  }
  const meta = readMeta(dst);
  if (meta?.managed) {
    throw new Error(
      `「${id}」是内置技能，不能卸载。可用 oh skills sync 更新，或用项目级 .agent-desk/skills 覆盖。`,
    );
  }
  fs.rmSync(dst, { recursive: true, force: true });
  return { id, removed: dst };
}
