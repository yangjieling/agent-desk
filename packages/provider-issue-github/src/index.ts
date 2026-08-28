import {
  registerIssueProvider,
  type IssueId,
  type IssueProvider,
  type IssueRecord,
  type ListIssuesOptions,
} from "@agent-desk/provider-issue";

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

function parseRepo(
  opts: GitHubIssueProviderOptions,
): { owner: string; repo: string } {
  const combined = (opts.repo ?? process.env.AD_GITHUB_REPO ?? "").trim();
  if (combined.includes("/")) {
    const [owner, repo] = combined.split("/", 2);
    if (owner && repo) return { owner, repo };
  }
  const owner = (opts.owner ?? process.env.AD_GITHUB_OWNER ?? "").trim();
  const repo = (opts.repoName ?? process.env.AD_GITHUB_REPO_NAME ?? "").trim();
  if (!owner || !repo) {
    throw new Error(
      "GitHub issue provider needs AD_GITHUB_REPO=owner/repo (or owner + repoName)",
    );
  }
  return { owner, repo };
}

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

  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly projectDir: string;
  private readonly apiBase: string;
  private readonly severityLabels: Record<string, string>;

  constructor(options: GitHubIssueProviderOptions = {}) {
    this.token = (options.token ?? process.env.AD_GITHUB_TOKEN ?? "").trim();
    const { owner, repo } = parseRepo(options);
    this.owner = owner;
    this.repo = repo;
    this.projectDir = (options.projectDir ?? process.env.AD_GITHUB_PROJECT_DIR ?? "").trim();
    this.apiBase = (options.apiBase ?? process.env.AD_GITHUB_API_BASE ?? "https://api.github.com")
      .trim()
      .replace(/\/$/, "");
    this.severityLabels = {
      ...DEFAULT_SEVERITY_LABELS,
      ...(options.severityLabels ?? {}),
    };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "agent-desk",
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        ...this.headers(),
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

  private toRecord(issue: GhIssue): IssueRecord {
    const labels = labelNames(issue.labels);
    return {
      code: `#${issue.number}`,
      title: issue.title ?? "",
      status: issue.state === "closed" ? "closed" : "open",
      severity: this.severityFromLabels(labels),
      description: issue.body ?? "",
      projectDir: this.projectDir,
      updatedAt: Date.parse(issue.updated_at) || Date.now(),
      url: issue.html_url,
      labels,
    };
  }

  private repoPath(): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  async listIssues(opts?: ListIssuesOptions): Promise<IssueRecord[]> {
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
      "GET",
      `${this.repoPath()}/issues?${params}`,
    );
    if (!rows) return [];
    // GitHub mixes PRs into /issues — drop them.
    return rows.filter((i) => !i.pull_request).map((i) => this.toRecord(i));
  }

  async getIssue(code: IssueId): Promise<IssueRecord | null> {
    const n = parseIssueNumber(code);
    if (!n) return null;
    const issue = await this.request<GhIssue | null>("GET", `${this.repoPath()}/issues/${n}`);
    if (!issue || issue.pull_request) return null;
    return this.toRecord(issue);
  }

  async upsertIssue(
    record: Partial<IssueRecord> & { code: IssueId },
  ): Promise<IssueRecord> {
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
        "PATCH",
        `${this.repoPath()}/issues/${n}`,
        body,
      );
      return this.toRecord(updated);
    }

    const title = (record.title ?? "").trim() || record.code;
    const created = await this.request<GhIssue>("POST", `${this.repoPath()}/issues`, {
      title,
      body: record.description ?? "",
      labels: record.labels ?? [],
    });
    return this.toRecord(created);
  }
}

export function registerGitHubIssueProvider(
  options?: GitHubIssueProviderOptions,
): GitHubIssueProvider | null {
  const repo = (options?.repo ?? process.env.AD_GITHUB_REPO ?? "").trim();
  const owner = (options?.owner ?? process.env.AD_GITHUB_OWNER ?? "").trim();
  const repoName = (options?.repoName ?? process.env.AD_GITHUB_REPO_NAME ?? "").trim();
  if (!repo && !(owner && repoName)) {
    // Soft-skip when not configured so local demos still boot.
    return null;
  }
  try {
    const provider = new GitHubIssueProvider(options);
    registerIssueProvider(provider);
    return provider;
  } catch {
    return null;
  }
}
