import {
  registerNotifyProvider,
  type GateNotifyPayload,
  type NotifyProvider,
  type TaskNotifyPayload,
} from "@agent-desk/provider-notify";

export class WebhookNotifyProvider implements NotifyProvider {
  readonly id = "webhook";
  readonly displayName = "Webhook";

  constructor(private readonly webhookUrl = process.env.AD_NOTIFY_WEBHOOK_URL ?? "") {}

  private async post(body: unknown): Promise<void> {
    if (!this.webhookUrl) return;
    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Webhook notify failed: ${res.status} ${await res.text()}`);
    }
  }

  async sendGate(payload: GateNotifyPayload): Promise<void> {
    await this.post({ type: "gate", ...payload });
  }

  async sendTaskUpdate(payload: TaskNotifyPayload): Promise<void> {
    await this.post({ type: "task_update", ...payload });
  }
}

export function registerWebhookNotifyProvider(url?: string): WebhookNotifyProvider {
  const provider = new WebhookNotifyProvider(url);
  registerNotifyProvider(provider);
  return provider;
}
