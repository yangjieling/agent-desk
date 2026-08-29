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
  // Demo rows so the bugs page is usable before GitHub is configured.
  void provider.upsertIssue({
    code: "#demo-1",
    title: "登录接口偶发 500",
    status: "open",
    severity: "high",
    description: "复现：连续登录 3 次后偶发 500。示例缺陷，可删可改。",
    projectDir: "",
    labels: ["demo", "backend"],
  });
  void provider.upsertIssue({
    code: "#demo-2",
    title: "设置页下拉被裁切",
    status: "open",
    severity: "medium",
    description: "示例：UI overflow。配置 GitHub Issues 后可切换真实缺陷源。",
    projectDir: "",
    labels: ["demo", "ui"],
  });
  void provider.upsertIssue({
    code: "#demo-3",
    title: "历史：通知文案笔误（已关闭示例）",
    status: "closed",
    severity: "low",
    description: "closed 示例，用于筛选验证。",
    projectDir: "",
    labels: ["demo"],
  });
  registerIssueProvider(provider);
  return provider;
}
