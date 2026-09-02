import type { NotifyWebhookSettings } from "@agent-desk/core";
import { DEFAULT_NOTIFY_WEBHOOK_SETTINGS } from "@agent-desk/core";

type SettingsSource = () => { notifyWebhook?: Partial<NotifyWebhookSettings> } | null | undefined;

let settingsSource: SettingsSource | null = null;

/** Register a getter (usually db.getSettings) so providers can read persisted config. */
export function setNotifyWebhookSettingsSource(source: SettingsSource | null): void {
  settingsSource = source;
}

function pick(envVal: string | undefined, stored: string | undefined): string {
  const fromEnv = (envVal ?? "").trim();
  if (fromEnv) return fromEnv;
  return (stored ?? "").trim();
}

/** Resolve webhook URL: non-empty env wins, else ~/.agent-desk settings. */
export function resolveNotifyWebhookUrl(
  stored?: Partial<NotifyWebhookSettings> | null,
): string {
  const fromDb: NotifyWebhookSettings = {
    ...DEFAULT_NOTIFY_WEBHOOK_SETTINGS,
    ...(settingsSource?.()?.notifyWebhook || {}),
    ...(stored || {}),
  };
  return pick(process.env.AD_NOTIFY_WEBHOOK_URL, fromDb.url);
}
