export interface GateNotifyPayload {
  taskId: string;
  title: string;
  gateHeading: string;
  choices: { label: string; value: string }[];
  webUrl: string;
  issueCode?: string;
}

export interface TaskNotifyPayload {
  taskId: string;
  title: string;
  status: string;
  message: string;
  webUrl: string;
  issueCode?: string;
}

export interface NotifyProvider {
  readonly id: string;
  readonly displayName: string;
  sendGate(payload: GateNotifyPayload): Promise<void>;
  sendTaskUpdate(payload: TaskNotifyPayload): Promise<void>;
}

const registry = new Map<string, NotifyProvider>();

export function registerNotifyProvider(provider: NotifyProvider): void {
  registry.set(provider.id, provider);
}

export function getNotifyProvider(id: string): NotifyProvider {
  const p = registry.get(id);
  if (!p) throw new Error(`Unknown notify provider: ${id}`);
  return p;
}

export function listNotifyProviders(): NotifyProvider[] {
  return [...registry.values()];
}
