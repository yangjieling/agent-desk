/**
 * Same-repo git worktree helpers for parallel tasks.
 *
 * Trees live under `<repo>/.worktrees/ad-<slug>/` with branch `ad/<slug>`.
 * Unpushed commits keep the tree; clean trees are removed on task end.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const GIT_TIMEOUT_MS = 120_000;
const IGNORE_ENTRY = ".worktrees/";

export type GitRunResult = { code: number; stdout: string; stderr: string };

export function runGit(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): GitRunResult {
  try {
    const r = spawnSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: timeoutMs,
    });
    return {
      code: r.status ?? 1,
      stdout: (r.stdout || "").trim(),
      stderr: (r.stderr || "").trim() || (r.error ? r.error.message : ""),
    };
  } catch (err) {
    return { code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

export function gitToplevel(dir: string): string | null {
  const text = (dir || "").trim();
  if (!text) return null;
  const base = fs.existsSync(text) ? text : path.dirname(text);
  if (!fs.existsSync(base)) return null;
  const r = runGit(base, ["rev-parse", "--show-toplevel"], 15_000);
  if (r.code !== 0 || !r.stdout) return null;
  try {
    return path.resolve(r.stdout);
  } catch {
    return r.stdout;
  }
}

function taskSlug(taskId: string): string {
  const short = (taskId || "task").trim().slice(0, 16) || "task";
  return short.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "") || "task";
}

export function worktreeBranchFor(taskId: string): string {
  return `ad/${taskSlug(taskId)}`;
}

export function worktreeDirFor(repoRoot: string, taskId: string): string {
  return path.join(repoRoot, ".worktrees", `ad-${taskSlug(taskId)}`);
}

export function ensureWorktreesGitignored(repoRoot: string): void {
  const gi = path.join(repoRoot, ".gitignore");
  try {
    if (fs.existsSync(gi)) {
      const text = fs.readFileSync(gi, "utf8");
      const lines = text.split(/\r?\n/);
      if (lines.some((ln) => ln.trim() === IGNORE_ENTRY || ln.trim() === ".worktrees")) return;
      const prefix = !text || text.endsWith("\n") ? "" : "\n";
      fs.writeFileSync(gi, `${text}${prefix}${IGNORE_ENTRY}\n`, "utf8");
    } else {
      fs.writeFileSync(gi, `${IGNORE_ENTRY}\n`, "utf8");
    }
  } catch {
    /* ignore */
  }
}

export function hasUnpushedCommits(worktreePath: string): boolean {
  const wt = (worktreePath || "").trim();
  if (!wt || !fs.existsSync(wt)) return false;
  const remotes = runGit(wt, ["for-each-ref", "--format=%(refname)", "refs/remotes"], 15_000);
  if (remotes.code !== 0) return true;
  if (!remotes.stdout) return false;
  const log = runGit(wt, ["log", "--oneline", "HEAD", "--not", "--remotes"], 15_000);
  if (log.code !== 0) return true;
  return Boolean(log.stdout);
}

export type PrepareWorktreeResult =
  | {
      ok: true;
      path: string;
      branch: string;
      workspaceRoot: string;
      reused: boolean;
    }
  | { ok: false; error: string };

export function prepareWorktree(input: {
  taskId: string;
  sourceDir: string;
  existingPath?: string;
  existingBranch?: string;
  existingRoot?: string;
}): PrepareWorktreeResult {
  const taskId = (input.taskId || "").trim();
  const existing = (input.existingPath || "").trim();
  if (existing && fs.existsSync(existing)) {
    return {
      ok: true,
      path: existing,
      branch: (input.existingBranch || "").trim(),
      workspaceRoot: (input.existingRoot || "").trim() || gitToplevel(existing) || "",
      reused: true,
    };
  }

  const source = (input.sourceDir || "").trim();
  if (!source || !fs.existsSync(source)) {
    return { ok: false, error: "工作区目录不可用，无法创建 worktree" };
  }

  const root = gitToplevel(source);
  if (!root) {
    return {
      ok: false,
      error: "工作区不是 Git 仓库，无法并行（请排队，或先初始化 git）",
    };
  }

  ensureWorktreesGitignored(root);
  const dest = worktreeDirFor(root, taskId);
  if (fs.existsSync(dest)) {
    runGit(root, ["worktree", "remove", "--force", dest], 30_000);
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const branch = worktreeBranchFor(taskId);
  const show = runGit(root, ["show-ref", "--verify", `refs/heads/${branch}`], 15_000);
  const add =
    show.code === 0
      ? runGit(root, ["worktree", "add", dest, branch])
      : runGit(root, ["worktree", "add", "-b", branch, dest]);
  if (add.code !== 0) {
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    runGit(root, ["worktree", "prune"], 30_000);
    return { ok: false, error: `创建 worktree 失败: ${add.stderr || "未知错误"}` };
  }

  return {
    ok: true,
    path: dest,
    branch,
    workspaceRoot: root,
    reused: false,
  };
}

export type CleanupWorktreeResult = {
  ok: boolean;
  kept: boolean;
  skipped?: boolean;
  error?: string;
};

export function cleanupWorktree(input: {
  worktreePath?: string;
  worktreeBranch?: string;
  workspaceRoot?: string;
  taskId: string;
}): CleanupWorktreeResult {
  const wt = (input.worktreePath || "").trim();
  if (!wt) return { ok: true, kept: false, skipped: true };
  const branch = (input.worktreeBranch || "").trim() || worktreeBranchFor(input.taskId);
  const root =
    (input.workspaceRoot || "").trim() || gitToplevel(wt) || path.dirname(path.dirname(wt));

  if (fs.existsSync(wt) && hasUnpushedCommits(wt)) {
    return { ok: true, kept: true };
  }

  if (fs.existsSync(wt) && root) {
    runGit(root, ["worktree", "remove", "--force", wt], 60_000);
  }
  try {
    if (fs.existsSync(wt)) fs.rmSync(wt, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (root && branch) {
    runGit(root, ["branch", "-D", branch], 30_000);
    runGit(root, ["worktree", "prune"], 30_000);
  }
  return { ok: true, kept: false };
}
