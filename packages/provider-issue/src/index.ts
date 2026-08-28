export type IssueId = string;

export interface IssueRecord {
  code: IssueId;
  title: string;
  status: string;
  severity: string;
  description: string;
  projectDir: string;
  updatedAt: number;
  /** Optional deep link (e.g. GitHub issue HTML URL). */
  url?: string;
  labels?: string[];
}

export interface ListIssuesOptions {
  state?: "open" | "closed" | "all";
  labels?: string[];
  /** Max issues to return (provider may paginate internally). */
  limit?: number;
}

export interface IssueProvider {
  readonly id: string;
  readonly displayName: string;
  listIssues(opts?: ListIssuesOptions): Promise<IssueRecord[]>;
  getIssue(code: IssueId): Promise<IssueRecord | null>;
  upsertIssue(record: Partial<IssueRecord> & { code: IssueId }): Promise<IssueRecord>;
}

const registry = new Map<string, IssueProvider>();

export function registerIssueProvider(provider: IssueProvider): void {
  registry.set(provider.id, provider);
}

export function getIssueProvider(id: string): IssueProvider {
  const p = registry.get(id);
  if (!p) throw new Error(`Unknown issue provider: ${id}`);
  return p;
}

export function listIssueProviders(): IssueProvider[] {
  return [...registry.values()];
}
