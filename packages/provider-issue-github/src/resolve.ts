import type { GitHubSettings } from "@agent-desk/core";
import { DEFAULT_GITHUB_SETTINGS } from "@agent-desk/core";

export type ResolvedGitHubConfig = {
  token: string;
  owner: string;
  repo: string;
  projectDir: string;
  apiBase: string;
};

type SettingsSource = () => { github?: Partial<GitHubSettings> } | null | undefined;

let settingsSource: SettingsSource | null = null;

/** Register a getter (usually db.getSettings) so providers can read persisted config. */
export function setGitHubSettingsSource(source: SettingsSource | null): void {
  settingsSource = source;
}

function pick(envVal: string | undefined, stored: string | undefined): string {
  const fromEnv = (envVal ?? "").trim();
  if (fromEnv) return fromEnv;
  return (stored ?? "").trim();
}

function parseRepo(parts: {
  repo: string;
  owner: string;
  repoName: string;
}): { owner: string; repo: string } {
  const combined = parts.repo.trim();
  if (combined.includes("/")) {
    const [owner, repo] = combined.split("/", 2);
    if (owner && repo) return { owner, repo };
  }
  const owner = parts.owner.trim();
  const repo = parts.repoName.trim();
  return { owner, repo };
}

/**
 * Resolve GitHub config: non-empty env wins, else ~/.agent-desk settings.
 */
export function resolveGitHubConfig(
  stored?: Partial<GitHubSettings> | null,
): ResolvedGitHubConfig {
  const fromDb: GitHubSettings = {
    ...DEFAULT_GITHUB_SETTINGS,
    ...(settingsSource?.()?.github || {}),
    ...(stored || {}),
  };
  const repo = pick(process.env.AD_GITHUB_REPO, fromDb.repo);
  const owner = pick(process.env.AD_GITHUB_OWNER, fromDb.owner);
  const repoName = pick(process.env.AD_GITHUB_REPO_NAME, fromDb.repoName);
  const parsed = parseRepo({ repo, owner, repoName });
  const apiBaseRaw = pick(process.env.AD_GITHUB_API_BASE, fromDb.apiBase);
  return {
    token: pick(process.env.AD_GITHUB_TOKEN, fromDb.token),
    owner: parsed.owner,
    repo: parsed.repo,
    projectDir: pick(process.env.AD_GITHUB_PROJECT_DIR, fromDb.projectDir),
    apiBase: (apiBaseRaw || "https://api.github.com").trim().replace(/\/$/, ""),
  };
}

export function isGitHubConfigured(cfg: ResolvedGitHubConfig): boolean {
  return Boolean(cfg.token && cfg.owner && cfg.repo);
}
