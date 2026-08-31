import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveGitHubConfig } from "./resolve.js";

const execFileAsync = promisify(execFile);

export type WorkspaceSource = "env" | "discovered" | "managed" | "cloned";

export interface IssueWorkspaceResult {
  projectDir: string;
  source: WorkspaceSource;
  owner: string;
  repo: string;
  cloned: boolean;
}

interface ManagedRegistry {
  paths: Record<string, { owner: string; repo: string; createdAt: number }>;
}

function home(): string {
  return path.resolve(os.homedir());
}

export function parseGitHubRepoFromEnv(): { owner: string; repo: string } {
  const cfg = resolveGitHubConfig();
  return { owner: cfg.owner, repo: cfg.repo };
}

function searchRoots(projectDirHint?: string): string[] {
  const roots: string[] = [home()];
  const raw = process.env.AD_FS_ROOTS || "";
  for (const part of raw.split(",")) {
    const text = part.trim();
    if (!text) continue;
    try {
      const candidate = path.resolve(text.replace(/^~(?=$|[/\\])/, home()));
      if (fs.existsSync(candidate)) roots.push(candidate);
    } catch {
      // ignore
    }
  }
  for (const name of ["IdeaProjects", "Projects", "workspace", "code", "dev", "CursorProjects"]) {
    const candidate = path.join(home(), name);
    try {
      if (fs.statSync(candidate).isDirectory()) roots.push(path.resolve(candidate));
    } catch {
      // ignore
    }
  }
  const projectDir = (projectDirHint ?? "").trim();
  if (projectDir) {
    try {
      const resolved = path.resolve(projectDir.replace(/^~(?=$|[/\\])/, home()));
      roots.push(resolved);
      const parent = path.dirname(resolved);
      if (parent && parent !== resolved) roots.push(parent);
    } catch {
      // ignore
    }
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of roots) {
    if (!seen.has(item)) {
      seen.add(item);
      unique.push(item);
    }
  }
  return unique;
}

function registryPath(dataDir: string): string {
  return path.join(dataDir, "workspaces", "auto", ".managed.json");
}

function loadRegistry(dataDir: string): ManagedRegistry {
  const file = registryPath(dataDir);
  try {
    if (!fs.existsSync(file)) return { paths: {} };
    return JSON.parse(fs.readFileSync(file, "utf8")) as ManagedRegistry;
  } catch {
    return { paths: {} };
  }
}

function saveRegistry(dataDir: string, registry: ManagedRegistry): void {
  const file = registryPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(registry, null, 2), "utf8");
}

export function autoWorkspacePath(dataDir: string, owner: string, repo: string): string {
  return path.join(dataDir, "workspaces", "auto", owner, repo);
}

export function isManagedAutoWorkspace(dataDir: string, projectDir: string): boolean {
  const resolved = path.resolve(projectDir);
  const registry = loadRegistry(dataDir);
  if (registry.paths[resolved]) return true;
  const prefix = path.join(dataDir, "workspaces", "auto") + path.sep;
  return resolved.startsWith(prefix);
}

function registerManagedPath(
  dataDir: string,
  projectDir: string,
  owner: string,
  repo: string,
): void {
  const resolved = path.resolve(projectDir);
  const registry = loadRegistry(dataDir);
  registry.paths[resolved] = { owner, repo, createdAt: Date.now() };
  saveRegistry(dataDir, registry);
}

function unregisterManagedPath(dataDir: string, projectDir: string): void {
  const resolved = path.resolve(projectDir);
  const registry = loadRegistry(dataDir);
  if (!registry.paths[resolved]) return;
  delete registry.paths[resolved];
  saveRegistry(dataDir, registry);
}

async function gitRemoteMatches(dir: string, owner: string, repo: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", dir, "remote", "-v"], {
      timeout: 10_000,
    });
    const needle = `${owner}/${repo}`;
    return stdout.includes(needle);
  } catch {
    return false;
  }
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], {
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function findLocalRepo(
  owner: string,
  repo: string,
  projectDirHint?: string,
): Promise<string | null> {
  const envDir = (projectDirHint ?? "").trim();
  if (envDir) {
    const resolved = path.resolve(envDir.replace(/^~(?=$|[/\\])/, home()));
    try {
      if (fs.existsSync(resolved) && (await isGitRepo(resolved))) {
        if (await gitRemoteMatches(resolved, owner, repo)) return resolved;
      }
    } catch {
      // ignore
    }
  }

  for (const root of searchRoots(projectDirHint)) {
    const direct = path.join(root, repo);
    try {
      if (fs.existsSync(direct) && fs.statSync(direct).isDirectory() && (await isGitRepo(direct))) {
        if (await gitRemoteMatches(direct, owner, repo)) return path.resolve(direct);
      }
    } catch {
      // ignore
    }

    let children: string[] = [];
    try {
      children = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of children) {
      if (name.startsWith(".")) continue;
      const child = path.join(root, name, repo);
      try {
        if (fs.existsSync(child) && fs.statSync(child).isDirectory() && (await isGitRepo(child))) {
          if (await gitRemoteMatches(child, owner, repo)) return path.resolve(child);
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function cloneUrl(owner: string, repo: string, token: string): string {
  if (token) {
    return `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
  }
  return `https://github.com/${owner}/${repo}.git`;
}

async function cloneRepo(
  owner: string,
  repo: string,
  dest: string,
  token: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    throw new Error(`clone destination already exists: ${dest}`);
  }
  await execFileAsync("git", ["clone", "--depth", "1", cloneUrl(owner, repo, token), dest], {
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function ensureIssueWorkspace(
  dataDir: string,
): Promise<IssueWorkspaceResult> {
  const cfg = resolveGitHubConfig();
  const { owner, repo } = cfg;
  if (!owner || !repo) {
    throw new Error("GitHub workspace needs repo=owner/repo in settings or AD_GITHUB_REPO");
  }

  const discovered = await findLocalRepo(owner, repo, cfg.projectDir);
  if (discovered) {
    return {
      projectDir: discovered,
      source: cfg.projectDir ? "env" : "discovered",
      owner,
      repo,
      cloned: false,
    };
  }

  const managed = autoWorkspacePath(dataDir, owner, repo);
  if (fs.existsSync(managed) && (await isGitRepo(managed))) {
    registerManagedPath(dataDir, managed, owner, repo);
    return { projectDir: managed, source: "managed", owner, repo, cloned: false };
  }

  await cloneRepo(owner, repo, managed, cfg.token);
  registerManagedPath(dataDir, managed, owner, repo);
  return { projectDir: managed, source: "cloned", owner, repo, cloned: true };
}

export async function maybeReleaseAutoWorkspace(
  dataDir: string,
  projectDir: string,
  activeTaskCount: number,
): Promise<boolean> {
  const resolved = path.resolve(projectDir);
  if (!resolved || !isManagedAutoWorkspace(dataDir, resolved)) return false;
  if (activeTaskCount > 0) return false;

  try {
    fs.rmSync(resolved, { recursive: true, force: true });
    unregisterManagedPath(dataDir, resolved);
    return true;
  } catch (err) {
    console.error(
      "[agent-desk] failed to remove auto workspace:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
