import type { FeishuSettings, Settings } from "@agent-desk/core";
import { DEFAULT_FEISHU_SETTINGS } from "@agent-desk/core";

type SettingsSource = () => Settings | null | undefined;

let settingsSource: SettingsSource | null = null;

export function setFeishuSettingsSource(source: SettingsSource | null): void {
  settingsSource = source;
}

function fromEnv(): Partial<FeishuSettings> {
  return {
    appId: (process.env.AD_FEISHU_APP_ID || "").trim(),
    appSecret: (process.env.AD_FEISHU_APP_SECRET || "").trim(),
    receiveId: (process.env.AD_FEISHU_RECEIVE_ID || "").trim(),
    receiveIdType: (process.env.AD_FEISHU_RECEIVE_ID_TYPE || "").trim(),
    apiBase: (process.env.AD_FEISHU_API_BASE || "").trim(),
    verificationToken: (process.env.AD_FEISHU_VERIFICATION_TOKEN || "").trim(),
    encryptKey: (process.env.AD_FEISHU_ENCRYPT_KEY || "").trim(),
  };
}

/** Env overrides DB when non-empty (same pattern as DingTalk). */
export function resolveFeishuConfig(
  stored?: FeishuSettings | null,
): FeishuSettings {
  const db = { ...DEFAULT_FEISHU_SETTINGS, ...(stored || {}) };
  const env = fromEnv();
  const pick = (envVal: string | undefined, dbVal: string) =>
    (envVal || "").trim() || dbVal || "";
  return {
    ...db,
    appId: pick(env.appId, db.appId),
    appSecret: pick(env.appSecret, db.appSecret),
    receiveId: pick(env.receiveId, db.receiveId),
    receiveIdType: pick(env.receiveIdType, db.receiveIdType) || "open_id",
    apiBase: pick(env.apiBase, db.apiBase),
    verificationToken: pick(env.verificationToken, db.verificationToken),
    encryptKey: pick(env.encryptKey, db.encryptKey),
  };
}

export function resolveFeishuConfigLive(): FeishuSettings {
  const settings = settingsSource?.() || null;
  return resolveFeishuConfig(settings?.feishu);
}
