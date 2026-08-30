import type { DingTalkSettings } from "@agent-desk/core";
import { DEFAULT_DINGTALK_SETTINGS } from "@agent-desk/core";

export type ResolvedDingTalkConfig = DingTalkSettings & {
  apiBase: string;
  openApiBase: string;
  wrapLinks: boolean;
};

type SettingsSource = () => { dingtalk?: Partial<DingTalkSettings> } | null | undefined;

let settingsSource: SettingsSource | null = null;

/** Register a getter (usually db.getSettings) so providers can read persisted config. */
export function setDingTalkSettingsSource(source: SettingsSource | null): void {
  settingsSource = source;
}

function pick(envVal: string | undefined, stored: string | undefined): string {
  const fromEnv = (envVal ?? "").trim();
  if (fromEnv) return fromEnv;
  return (stored ?? "").trim();
}

/**
 * Resolve DingTalk config: non-empty env wins, else overrides + ~/.agent-desk settings.
 */
export function resolveDingTalkConfig(
  stored?: Partial<DingTalkSettings> | null,
): ResolvedDingTalkConfig {
  const fromDb: DingTalkSettings = {
    ...DEFAULT_DINGTALK_SETTINGS,
    ...(settingsSource?.()?.dingtalk || {}),
    ...(stored || {}),
  };
  const wrapEnv = (process.env.AD_DINGTALK_WRAP_LINKS ?? "1").trim();
  return {
    webhook: pick(process.env.AD_DINGTALK_WEBHOOK, fromDb.webhook),
    secret: pick(process.env.AD_DINGTALK_SECRET, fromDb.secret),
    keyword: pick(process.env.AD_DINGTALK_KEYWORD, fromDb.keyword),
    appKey: pick(process.env.AD_DINGTALK_APP_KEY, fromDb.appKey),
    appSecret: pick(process.env.AD_DINGTALK_APP_SECRET, fromDb.appSecret),
    agentId: pick(process.env.AD_DINGTALK_AGENT_ID, fromDb.agentId),
    userIds: pick(process.env.AD_DINGTALK_USER_IDS, fromDb.userIds),
    cardTemplateId: pick(
      process.env.AD_DINGTALK_CARD_TEMPLATE_ID,
      fromDb.cardTemplateId,
    ),
    apiBase: (
      process.env.AD_DINGTALK_API_BASE ?? "https://oapi.dingtalk.com"
    )
      .trim()
      .replace(/\/$/, ""),
    openApiBase: (
      process.env.AD_DINGTALK_OPEN_API_BASE ?? "https://api.dingtalk.com"
    )
      .trim()
      .replace(/\/$/, ""),
    wrapLinks: !(wrapEnv === "0" || wrapEnv.toLowerCase() === "false"),
  };
}

export function usesInteractiveGate(cfg: ResolvedDingTalkConfig): boolean {
  return Boolean(cfg.appKey && cfg.appSecret && cfg.userIds && cfg.cardTemplateId);
}

export function isDingTalkConfigured(cfg: ResolvedDingTalkConfig): boolean {
  return Boolean(
    cfg.webhook ||
      usesInteractiveGate(cfg) ||
      (cfg.appKey && cfg.appSecret && cfg.agentId && cfg.userIds),
  );
}
