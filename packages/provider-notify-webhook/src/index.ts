import {
  registerNotifyProvider,
  type GateNotifyPayload,
  type NotifyProvider,
  type TaskNotifyPayload,
} from "@agent-desk/provider-notify";
import { resolveNotifyWebhookUrl } from "./resolve.js";

export { resolveNotifyWebhookUrl, setNotifyWebhookSettingsSource } from "./resolve.js";

export class WebhookNotifyProvider implements NotifyProvider {
  readonly id = "webhook";
  readonly displayName = "Webhook";

  private webhookUrl(): string {
    return resolveNotifyWebhookUrl();
  }

  private async post(body: unknown): Promise<void> {
    const url = this.webhookUrl();
    if (!url) return;
    const res = await fetch(url, {
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

export function registerWebhookNotifyProvider(): WebhookNotifyProvider {
  const provider = new WebhookNotifyProvider();
  registerNotifyProvider(provider);
  return provider;
}
