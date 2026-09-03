import {
  registerIssueProvider,
  type IssueId,
  type IssueProvider,
  type IssueRecord,
  type ListIssuesOptions,
} from "@agent-desk/provider-issue";
import {
  resolveGitHubConfig,
  type ResolvedGitHubConfig,
} from "./resolve.js";

export interface GitHubIssueProviderOptions {
  token?: string;
  /** owner/repo, e.g. "acme/app" */
  repo?: string;
  owner?: string;
  repoName?: string;
  /** Filled into IssueRecord.projectDir when mapping. */
  projectDir?: string;
  /** Override API host (GitHub Enterprise). Default api.github.com */
  apiBase?: string;
  /**
   * Map label name (case-insensitive) → severity.
   * Unmatched issues default to "medium".
   */
  severityLabels?: Record<string, string>;
}

interface GhLabel {
  name: string;
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  html_url: string;
  updated_at: string;
  labels: GhLabel[] | string[];
  pull_request?: unknown;
}

const DEFAULT_SEVERITY_LABELS: Record<string, string> = {
  "severity:critical": "critical",
  "severity:high": "high",
  "severity:medium": "medium",
  "severity:low": "low",
  critical: "critical",
  blocker: "critical",
  high: "high",
  major: "high",
  medium: "medium",
  normal: "medium",
  low: "low",
  minor: "low",
};

function parseIssueNumber(code: IssueId): number | null {
  const raw = String(code ?? "").trim();
  if (!raw) return null;
  // Accept "#12", "12", "owner/repo#12"
  const m = raw.match(/(?:^|\/|#)(\d+)$/) ?? raw.match(/^(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function labelNames(labels: GhIssue["labels"]): string[] {
  return labels.map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
}

export class GitHubIssueProvider implements IssueProvider {
  readonly id = "github";
  readonly displayName = "GitHub Issues";

  private readonly options: GitHubIssueProviderOptions;
  private readonly severityLabels: Record<string, string>;

  constructor(options: GitHubIssueProviderOptions = {}) {
    this.options = options;
    this.severityLabels = {
      ...DEFAULT_SEVERITY_LABELS,
      ...(options.severityLabels ?? {}),
    };
  }

  private cfg(): ResolvedGitHubConfig {
    const o = this.options;
    return resolveGitHubConfig({
      token: o.token,
      repo: o.repo,
      owner: o.owner,
      repoName: o.repoName,
      projectDir: o.projectDir,
      apiBase: o.apiBase,
    });
  }

  private headers(token: string): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "agent-desk",
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  private async request<T>(
    cfg: ResolvedGitHubConfig,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${cfg.apiBase}${path}`, {
      method,
      headers: {
        ...this.headers(cfg.token),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) {
      return null as T;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private severityFromLabels(names: string[]): string {
    const map = new Map(
      Object.entries(this.severityLabels).map(([k, v]) => [k.toLowerCase(), v]),
    );
    for (const name of names) {
      const hit = map.get(name.toLowerCase());
      if (hit) return hit;
    }
    return "medium";
  }

  private toRecord(cfg: ResolvedGitHubConfig, issue: GhIssue): IssueRecord {
    const labels = labelNames(issue.labels);
    return {
      code: `#${issue.number}`,
      title: issue.title ?? "",
      status: issue.state === "closed" ? "closed" : "open",
      severity: this.severityFromLabels(labels),
      description: issue.body ?? "",
      projectDir: cfg.projectDir,
      updatedAt: Date.parse(issue.updated_at) || Date.now(),
      url: issue.html_url,
      labels,
    };
  }

  private repoPath(cfg: ResolvedGitHubConfig): string {
    if (!cfg.owner || !cfg.repo) {
      throw new Error(
        "GitHub issue provider needs repo=owner/repo in settings or AD_GITHUB_REPO",
      );
    }
    return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  }

  async listIssues(opts?: ListIssuesOptions): Promise<IssueRecord[]> {
    const cfg = this.cfg();
    void this.repoPath(cfg);
    const state = opts?.state ?? "open";
    const limit = opts?.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 30;
    const params = new URLSearchParams({
      state,
      per_page: String(limit),
      sort: "updated",
      direction: "desc",
    });
    if (opts?.labels?.length) {
      params.set("labels", opts.labels.join(","));
    }

    const rows = await this.request<GhIssue[] | null>(
      cfg,
      "GET",
      `${this.repoPath(cfg)}/issues?${params}`,
    );
    if (!rows) return [];
    // GitHub mixes PRs into /issues — drop them.
    return rows.filter((i) => !i.pull_request).map((i) => this.toRecord(cfg, i));
  }

  async getIssue(code: IssueId): Promise<IssueRecord | null> {
    const cfg = this.cfg();
    const n = parseIssueNumber(code);
    if (!n) return null;
    const issue = await this.request<GhIssue | null>(
      cfg,
      "GET",
      `${this.repoPath(cfg)}/issues/${n}`,
    );
    if (!issue || issue.pull_request) return null;
    return this.toRecord(cfg, issue);
  }

  async upsertIssue(
    record: Partial<IssueRecord> & { code: IssueId },
  ): Promise<IssueRecord> {
    const cfg = this.cfg();
    const n = parseIssueNumber(record.code);
    if (n) {
      const body: Record<string, unknown> = {};
      if (record.title !== undefined) body.title = record.title;
      if (record.description !== undefined) body.body = record.description;
      if (record.status !== undefined) {
        body.state = record.status === "closed" ? "closed" : "open";
      }
      if (record.labels !== undefined) body.labels = record.labels;
      const updated = await this.request<GhIssue>(
        cfg,
        "PATCH",
        `${this.repoPath(cfg)}/issues/${n}`,
        body,
      );
      return this.toRecord(cfg, updated);
    }

    const title = (record.title ?? "").trim() || record.code;
    const created = await this.request<GhIssue>(cfg, "POST", `${this.repoPath(cfg)}/issues`, {
      title,
      body: record.description ?? "",
      labels: record.labels ?? [],
    });
    return this.toRecord(cfg, created);
  }
}

export function registerGitHubIssueProvider(
  options?: GitHubIssueProviderOptions,
): GitHubIssueProvider {
  const provider = new GitHubIssueProvider(options);
  registerIssueProvider(provider);
  return provider;
}

export {
  autoWorkspacePath,
  ensureIssueWorkspace,
  isManagedAutoWorkspace,
  maybeReleaseAutoWorkspace,
  parseAutoWorkspaceOwnerRepo,
  parseGitHubRepoFromEnv,
  restoreManagedAutoWorkspaceIfMissing,
  type IssueWorkspaceResult,
  type RestoreAutoWorkspaceResult,
  type WorkspaceSource,
} from "./workspace.js";

export {
  isGitHubConfigured,
  resolveGitHubConfig,
  setGitHubSettingsSource,
  type ResolvedGitHubConfig,
} from "./resolve.js";
