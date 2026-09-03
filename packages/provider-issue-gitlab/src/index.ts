import {
  registerIssueProvider,
  type IssueId,
  type IssueProvider,
  type IssueRecord,
  type ListIssuesOptions,
} from "@agent-desk/provider-issue";
import {
  encodeGitLabProjectId,
  resolveGitLabConfig,
  type ResolvedGitLabConfig,
} from "./resolve.js";

export interface GitLabIssueProviderOptions {
  token?: string;
  /** group/project or numeric id, e.g. "acme/app" */
  project?: string;
  /** Filled into IssueRecord.projectDir when mapping. */
  projectDir?: string;
  /** Override API host (self-managed GitLab). Default gitlab.com/api/v4 */
  apiBase?: string;
  /**
   * Map label name (case-insensitive) → severity.
   * Unmatched issues default to "medium".
   */
  severityLabels?: Record<string, string>;
}

interface GlIssue {
  iid: number;
  title: string;
  state: string;
  description: string | null;
  web_url: string;
  updated_at: string;
  labels: string[];
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

function parseIssueIid(code: IssueId): number | null {
  const raw = String(code ?? "").trim();
  if (!raw) return null;
  // Accept "#12", "12", "group/project#12"
  const m = raw.match(/(?:^|\/|#)(\d+)$/) ?? raw.match(/^(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export class GitLabIssueProvider implements IssueProvider {
  readonly id = "gitlab";
  readonly displayName = "GitLab Issues";

  private readonly options: GitLabIssueProviderOptions;
  private readonly severityLabels: Record<string, string>;

  constructor(options: GitLabIssueProviderOptions = {}) {
    this.options = options;
    this.severityLabels = {
      ...DEFAULT_SEVERITY_LABELS,
      ...(options.severityLabels ?? {}),
    };
  }

  private cfg(): ResolvedGitLabConfig {
    const o = this.options;
    return resolveGitLabConfig({
      token: o.token,
      project: o.project,
      projectDir: o.projectDir,
      apiBase: o.apiBase,
    });
  }

  private headers(token: string): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "agent-desk",
    };
    if (token) h["PRIVATE-TOKEN"] = token;
    return h;
  }

  private async request<T>(
    cfg: ResolvedGitLabConfig,
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
      throw new Error(`GitLab API ${method} ${path} failed: ${res.status} ${text}`);
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

  private toRecord(cfg: ResolvedGitLabConfig, issue: GlIssue): IssueRecord {
    const labels = Array.isArray(issue.labels) ? issue.labels.filter(Boolean) : [];
    return {
      code: `#${issue.iid}`,
      title: issue.title ?? "",
      status: issue.state === "closed" ? "closed" : "open",
      severity: this.severityFromLabels(labels),
      description: issue.description ?? "",
      projectDir: cfg.projectDir,
      updatedAt: Date.parse(issue.updated_at) || Date.now(),
      url: issue.web_url,
      labels,
    };
  }

  private projectPath(cfg: ResolvedGitLabConfig): string {
    if (!cfg.project) {
      throw new Error(
        "GitLab issue provider needs project=group/name in settings or AD_GITLAB_PROJECT",
      );
    }
    return `/projects/${encodeGitLabProjectId(cfg.project)}`;
  }

  async listIssues(opts?: ListIssuesOptions): Promise<IssueRecord[]> {
    const cfg = this.cfg();
    void this.projectPath(cfg);
    const stateRaw = opts?.state ?? "open";
    const state =
      stateRaw === "closed" ? "closed" : stateRaw === "all" ? "all" : "opened";
    const limit = opts?.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 30;
    const params = new URLSearchParams({
      state,
      per_page: String(limit),
      order_by: "updated_at",
      sort: "desc",
    });
    if (opts?.labels?.length) {
      params.set("labels", opts.labels.join(","));
    }

    const rows = await this.request<GlIssue[] | null>(
      cfg,
      "GET",
      `${this.projectPath(cfg)}/issues?${params}`,
    );
    if (!rows) return [];
    return rows.map((i) => this.toRecord(cfg, i));
  }

  async getIssue(code: IssueId): Promise<IssueRecord | null> {
    const cfg = this.cfg();
    const iid = parseIssueIid(code);
    if (!iid) return null;
    const issue = await this.request<GlIssue | null>(
      cfg,
      "GET",
      `${this.projectPath(cfg)}/issues/${iid}`,
    );
    if (!issue) return null;
    return this.toRecord(cfg, issue);
  }

  async upsertIssue(
    record: Partial<IssueRecord> & { code: IssueId },
  ): Promise<IssueRecord> {
    const cfg = this.cfg();
    const iid = parseIssueIid(record.code);
    if (iid) {
      const body: Record<string, unknown> = {};
      if (record.title !== undefined) body.title = record.title;
      if (record.description !== undefined) body.description = record.description;
      if (record.status !== undefined) {
        body.state_event = record.status === "closed" ? "close" : "reopen";
      }
      if (record.labels !== undefined) body.labels = record.labels.join(",");
      const updated = await this.request<GlIssue>(
        cfg,
        "PUT",
        `${this.projectPath(cfg)}/issues/${iid}`,
        body,
      );
      return this.toRecord(cfg, updated);
    }

    const title = (record.title ?? "").trim() || record.code;
    const created = await this.request<GlIssue>(cfg, "POST", `${this.projectPath(cfg)}/issues`, {
      title,
      description: record.description ?? "",
      labels: (record.labels ?? []).join(","),
    });
    return this.toRecord(cfg, created);
  }
}

export function registerGitLabIssueProvider(
  options?: GitLabIssueProviderOptions,
): GitLabIssueProvider {
  const provider = new GitLabIssueProvider(options);
  registerIssueProvider(provider);
  return provider;
}

export {
  encodeGitLabProjectId,
  isGitLabConfigured,
  resolveGitLabConfig,
  setGitLabSettingsSource,
  type ResolvedGitLabConfig,
} from "./resolve.js";
