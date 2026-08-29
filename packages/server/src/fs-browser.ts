import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_ENTRIES = 300;

function home(): string {
  return path.resolve(os.homedir());
}

function extraRoots(): string[] {
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

function resolveDir(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return home();
  return path.resolve(text.replace(/^~(?=$|[/\\])/, home()));
}

function isAllowed(targetRaw: string): boolean {
  const target = path.resolve(targetRaw);
  // Allow macOS /Users (and Linux /home) so users can pick among accounts / up from home.
  if (target === "/Users" || target.startsWith("/Users" + path.sep)) return true;
  if (target === "/home" || target.startsWith("/home" + path.sep)) return true;
  for (const root of extraRoots()) {
    if (target === root || target.startsWith(root + path.sep)) return true;
    // Allow walking up to ancestors of configured roots (e.g. home → /Users).
    if (root === target || root.startsWith(target + path.sep)) return true;
  }
  return false;
}

export interface FsBrowseResult {
  ok: boolean;
  error?: string;
  path?: string;
  parent?: string;
  entries?: { name: string; path: string }[];
  truncated?: boolean;
}

/** List one level of subfolders (local workspace picker). */
export function browse(rawPath = ""): FsBrowseResult {
  let current: string;
  try {
    current = resolveDir(rawPath);
  } catch (e) {
    return { ok: false, error: `无效路径: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    if (!fs.existsSync(current)) return { ok: false, error: "路径不存在" };
    if (!fs.statSync(current).isDirectory()) return { ok: false, error: "不是目录" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!isAllowed(current)) {
    return { ok: false, error: "无权访问该路径(仅允许主目录及常见项目目录)" };
  }

  let parent = "";
  const parentPath = path.resolve(current, "..");
  if (parentPath !== current && isAllowed(parentPath)) parent = parentPath;

  const entries: { name: string; path: string }[] = [];
  let children: string[];
  try {
    children = fs.readdirSync(current).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "EACCES") {
      return { ok: false, error: "无权限读取该目录" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  for (const name of children) {
    if (entries.length >= MAX_ENTRIES) break;
    if (name.startsWith(".")) continue;
    const child = path.join(current, name);
    try {
      if (!fs.statSync(child).isDirectory()) continue;
      const resolved = path.resolve(child);
      if (!isAllowed(resolved)) continue;
      entries.push({ name, path: resolved });
    } catch {
      // ignore
    }
  }

  return {
    ok: true,
    path: current,
    parent,
    entries,
    truncated: entries.length >= MAX_ENTRIES,
  };
}

export function mkdir(parentRaw: string, name: string): FsBrowseResult & { created?: string } {
  const parent = resolveDir(parentRaw);
  const folderName = (name || "").trim();
  if (!folderName || /[/\\]/.test(folderName) || folderName === "." || folderName === "..") {
    return { ok: false, error: "文件夹名称无效" };
  }
  if (!isAllowed(parent)) {
    return { ok: false, error: "无权在该路径创建目录" };
  }
  const target = path.join(parent, folderName);
  if (!isAllowed(target)) {
    return { ok: false, error: "无权创建该路径" };
  }
  try {
    if (fs.existsSync(target)) return { ok: false, error: "已存在同名文件或文件夹" };
    fs.mkdirSync(target);
    return { ok: true, path: parent, created: path.resolve(target) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
