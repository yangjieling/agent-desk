import type { GitLabSettings } from "@agent-desk/core";
import { DEFAULT_GITLAB_SETTINGS } from "@agent-desk/core";

export type ResolvedGitLabConfig = {
  token: string;
  /** group/project path or numeric project id */
  project: string;
  projectDir: string;
  apiBase: string;
};

type SettingsSource = () => { gitlab?: Partial<GitLabSettings> } | null | undefined;

let settingsSource: SettingsSource | null = null;

/** Register a getter (usually db.getSettings) so providers can read persisted config. */
export function setGitLabSettingsSource(source: SettingsSource | null): void {
  settingsSource = source;
}

function pick(envVal: string | undefined, stored: string | undefined): string {
  const fromEnv = (envVal ?? "").trim();
  if (fromEnv) return fromEnv;
  return (stored ?? "").trim();
}

function definedPatch<T extends Record<string, unknown>>(
  patch: Partial<T> | null | undefined,
): Partial<T> {
  if (!patch) return {};
  const out: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const val = patch[key];
    if (val !== undefined) out[key] = val;
  }
  return out;
}

/**
 * Resolve GitLab config: non-empty env wins, else ~/.agent-desk settings.
 */
export function resolveGitLabConfig(
  stored?: Partial<GitLabSettings> | null,
): ResolvedGitLabConfig {
  const fromDb: GitLabSettings = {
    ...DEFAULT_GITLAB_SETTINGS,
    ...(settingsSource?.()?.gitlab || {}),
    ...definedPatch(stored),
  };
  const apiBaseRaw = pick(process.env.AD_GITLAB_API_BASE, fromDb.apiBase);
  return {
    token: pick(process.env.AD_GITLAB_TOKEN, fromDb.token),
    project: pick(process.env.AD_GITLAB_PROJECT, fromDb.project),
    projectDir: pick(process.env.AD_GITLAB_PROJECT_DIR, fromDb.projectDir),
    apiBase: (apiBaseRaw || "https://gitlab.com/api/v4").trim().replace(/\/$/, ""),
  };
}

export function isGitLabConfigured(cfg: ResolvedGitLabConfig): boolean {
  return Boolean(cfg.token && cfg.project);
}

/** URL-encode project path for /projects/:id (keeps numeric ids as-is). */
export function encodeGitLabProjectId(project: string): string {
  const p = project.trim();
  if (!p) return "";
  if (/^\d+$/.test(p)) return p;
  return encodeURIComponent(p);
}
