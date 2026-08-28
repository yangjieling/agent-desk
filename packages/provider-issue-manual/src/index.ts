import {
  registerIssueProvider,
  type IssueId,
  type IssueProvider,
  type IssueRecord,
  type ListIssuesOptions,
} from "@agent-desk/provider-issue";

export class ManualIssueProvider implements IssueProvider {
  readonly id = "manual";
  readonly displayName = "Manual (local JSON)";

  private readonly store = new Map<IssueId, IssueRecord>();

  async listIssues(opts?: ListIssuesOptions): Promise<IssueRecord[]> {
    let rows = [...this.store.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const state = opts?.state ?? "all";
    if (state !== "all") {
      rows = rows.filter((r) => r.status === state);
    }
    if (opts?.labels?.length) {
      const want = new Set(opts.labels.map((l) => l.toLowerCase()));
      rows = rows.filter((r) => (r.labels ?? []).some((l) => want.has(l.toLowerCase())));
    }
    if (opts?.limit && opts.limit > 0) {
      rows = rows.slice(0, opts.limit);
    }
    return rows;
  }

  async getIssue(code: IssueId): Promise<IssueRecord | null> {
    return this.store.get(code) ?? null;
  }

  async upsertIssue(record: Partial<IssueRecord> & { code: IssueId }): Promise<IssueRecord> {
    const now = Date.now();
    const existing = this.store.get(record.code);
    const merged: IssueRecord = {
      code: record.code,
      title: record.title ?? existing?.title ?? "",
      status: record.status ?? existing?.status ?? "open",
      severity: record.severity ?? existing?.severity ?? "medium",
      description: record.description ?? existing?.description ?? "",
      projectDir: record.projectDir ?? existing?.projectDir ?? "",
      updatedAt: now,
      url: record.url ?? existing?.url,
      labels: record.labels ?? existing?.labels,
    };
    this.store.set(record.code, merged);
    return merged;
  }
}

export function registerManualIssueProvider(): ManualIssueProvider {
  const provider = new ManualIssueProvider();
  registerIssueProvider(provider);
  return provider;
}
