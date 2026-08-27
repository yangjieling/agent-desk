import {
  registerIssueProvider,
  type IssueId,
  type IssueProvider,
  type IssueRecord,
} from "@agent-desk/provider-issue";

export class ManualIssueProvider implements IssueProvider {
  readonly id = "manual";
  readonly displayName = "Manual (local JSON)";

  private readonly store = new Map<IssueId, IssueRecord>();

  async listIssues(): Promise<IssueRecord[]> {
    return [...this.store.values()].sort((a, b) => b.updatedAt - a.updatedAt);
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
