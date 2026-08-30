import { createHmac } from "node:crypto";
import type { DingTalkSettings } from "@agent-desk/core";
import {
  registerNotifyProvider,
  type GateNotifyPayload,
  type NotifyProvider,
  type TaskNotifyPayload,
} from "@agent-desk/provider-notify";
import { encodeGateOutTrackId } from "./card-track.js";
import {
  isDingTalkConfigured,
  resolveDingTalkConfig,
  usesInteractiveGate,
  type ResolvedDingTalkConfig,
} from "./resolve.js";

export interface DingTalkNotifyProviderOptions extends Partial<DingTalkSettings> {
  apiBase?: string;
  openApiBase?: string;
  wrapLinks?: boolean;
}

interface TokenCache {
  token: string;
  expiresAt: number;
  appKey: string;
}

const MAX_CHOICE_BUTTONS = 3;
/** DingTalk ActionCard independent buttons max out at 5. */
const MAX_CARD_BUTTONS = 5;

function toStringMap(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

function originOf(webUrl: string): string {
  try {
    return new URL(webUrl).origin;
  } catch {
    return "http://127.0.0.1:19877";
  }
}

export function gateChoiceUrl(webUrl: string, taskId: string, reply: string): string {
  const base = originOf(webUrl);
  return `${base}/api/tasks/${encodeURIComponent(taskId)}/resume?reply=${encodeURIComponent(reply)}`;
}

/** DingTalk PC often needs this scheme to open an external browser. */
export function dingtalkOpenUrl(url: string, wrap: boolean): string {
  if (!wrap) return url;
  if (url.startsWith("dingtalk://")) return url;
  return `dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(url)}`;
}

function signedWebhookUrl(webhook: string, secret: string): string {
  const timestamp = String(Date.now());
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = createHmac("sha256", secret)
    .update(stringToSign)
    .digest("base64");
  const u = new URL(webhook);
  u.searchParams.set("timestamp", timestamp);
  u.searchParams.set("sign", sign);
  return u.toString();
}

async function readDingTalkJson(res: Response): Promise<{
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
  raw: string;
}> {
  const raw = await res.text();
  try {
    return { ...(JSON.parse(raw) as Record<string, unknown>), raw } as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
      raw: string;
    };
  } catch {
    return { raw };
  }
}

export class DingTalkNotifyProvider implements NotifyProvider {
  readonly id = "dingtalk";
  readonly displayName = "DingTalk";

  private readonly overrides: Partial<DingTalkSettings>;
  private readonly wrapLinksOverride?: boolean;
  private readonly apiBaseOverride?: string;
  private readonly openApiBaseOverride?: string;
  private tokenCache: TokenCache | null = null;

  constructor(options: DingTalkNotifyProviderOptions = {}) {
    const {
      apiBase,
      openApiBase,
      wrapLinks,
      webhook,
      secret,
      keyword,
      appKey,
      appSecret,
      agentId,
      userIds,
      cardTemplateId,
    } = options;
    this.apiBaseOverride = apiBase?.trim();
    this.openApiBaseOverride = openApiBase?.trim();
    this.wrapLinksOverride = wrapLinks;
    this.overrides = {
      webhook,
      secret,
      keyword,
      appKey,
      appSecret,
      agentId,
      userIds,
      cardTemplateId,
    };
  }

  private cfg(): ResolvedDingTalkConfig {
    const base = resolveDingTalkConfig(
      Object.fromEntries(
        Object.entries(this.overrides).filter(([, v]) => v != null && String(v).trim() !== ""),
      ) as Partial<DingTalkSettings>,
    );
    return {
      ...base,
      apiBase: this.apiBaseOverride || base.apiBase,
      openApiBase: this.openApiBaseOverride || base.openApiBase,
      wrapLinks: this.wrapLinksOverride ?? base.wrapLinks,
    };
  }

  /** Interactive card + Stream path (no browser jump). */
  usesInteractiveGate(): boolean {
    return usesInteractiveGate(this.cfg());
  }

  /** Whether webhook or work-notify / interactive credentials are present. */
  isConfigured(): boolean {
    return isDingTalkConfigured(this.cfg());
  }

  private requireConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        "DingTalk notify needs webhook or app key/secret + userIds (set via env AD_DINGTALK_* or Settings → 钉钉)",
      );
    }
  }

  private link(url: string): string {
    return dingtalkOpenUrl(url, this.cfg().wrapLinks);
  }

  /** Ensure keyword-security robots accept the message. */
  private withKeyword(markdown: string): string {
    const keyword = this.cfg().keyword;
    if (!keyword) return markdown;
    if (markdown.includes(keyword)) return markdown;
    return `${keyword}\n\n${markdown}`;
  }

  private async accessToken(): Promise<string> {
    const cfg = this.cfg();
    const now = Date.now();
    if (
      this.tokenCache &&
      this.tokenCache.appKey === cfg.appKey &&
      this.tokenCache.expiresAt > now + 60_000
    ) {
      return this.tokenCache.token;
    }
    const qs = new URLSearchParams({
      appkey: cfg.appKey,
      appsecret: cfg.appSecret,
    });
    const res = await fetch(`${cfg.apiBase}/gettoken?${qs}`);
    const data = await readDingTalkJson(res);
    if (!res.ok || data.errcode !== 0 || !data.access_token) {
      throw new Error(
        `DingTalk token failed: HTTP ${res.status} errcode=${data.errcode} ${data.errmsg ?? data.raw.slice(0, 200)}`,
      );
    }
    this.tokenCache = {
      token: data.access_token,
      expiresAt: now + (data.expires_in ?? 7200) * 1000,
      appKey: cfg.appKey,
    };
    return data.access_token;
  }

  private async sendWebhookActionCard(card: {
    title: string;
    text: string;
    btns: { title: string; actionURL: string }[];
  }): Promise<void> {
    const cfg = this.cfg();
    let url = cfg.webhook;
    if (cfg.secret) url = signedWebhookUrl(url, cfg.secret);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        msgtype: "actionCard",
        actionCard: {
          title: card.title,
          text: card.text,
          btnOrientation: "0",
          btns: card.btns,
        },
      }),
    });
    const data = await readDingTalkJson(res);
    if (!res.ok || (data.errcode !== undefined && data.errcode !== 0)) {
      throw new Error(
        `DingTalk webhook failed: HTTP ${res.status} errcode=${data.errcode} ${data.errmsg ?? data.raw.slice(0, 200)}`,
      );
    }
  }

  private async sendWorkActionCard(card: {
    title: string;
    markdown: string;
    btns: { title: string; action_url: string }[];
  }): Promise<void> {
    const cfg = this.cfg();
    const token = await this.accessToken();
    const res = await fetch(
      `${cfg.apiBase}/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          agent_id: Number(cfg.agentId) || cfg.agentId,
          userid_list: cfg.userIds,
          msg: {
            msgtype: "action_card",
            action_card: {
              title: card.title,
              markdown: card.markdown,
              btn_orientation: "0",
              btn_json_list: card.btns,
            },
          },
        }),
      },
    );
    const data = await readDingTalkJson(res);
    if (!res.ok || data.errcode !== 0) {
      throw new Error(
        `DingTalk work notify failed: HTTP ${res.status} errcode=${data.errcode} ${data.errmsg ?? data.raw.slice(0, 200)}`,
      );
    }
  }

  private userIdList(): string[] {
    return this.cfg()
      .userIds.split(/[,;\s]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
  }

  /**
   * Create + deliver an interactive gate card (Stream callback, no browser jump).
   */
  private async sendInteractiveGate(payload: GateNotifyPayload): Promise<void> {
    const cfg = this.cfg();
    const token = await this.accessToken();
    const recipients = this.userIdList();
    if (!recipients.length) {
      throw new Error("DingTalk interactive card needs AD_DINGTALK_USER_IDS or Settings.dingtalk.userIds");
    }

    const choiceLimit = Math.min(MAX_CHOICE_BUTTONS, payload.choices.length);
    const choices = payload.choices.slice(0, choiceLimit);
    const issue = payload.issueCode ? ` · ${payload.issueCode}` : "";
    const description = [
      payload.gateHeading || "需要确认",
      "",
      "点选项按钮或输入自定义内容后点「提交」即可回复任务（无需打开浏览器）。",
      "请保持 `oh web` / Stream 在运行。",
    ].join("\n");

    const buttonTexts = ["", "", ""];
    const btns = choices.map((c, i) => {
      const text = (c.label || c.value || `选项${i + 1}`).slice(0, 20);
      buttonTexts[i] = text;
      return {
        text,
        color: i === 0 ? "blue" : "gray",
        status: "normal",
        event: {
          type: "sendCardRequest",
          params: {
            actionId: `choice_${i + 1}`,
            params: { reply: c.value || text },
          },
        },
      };
    });

    const cardParamMap = toStringMap({
      title: `${payload.title || "Task"}${issue}`,
      description,
      buttonText1: buttonTexts[0],
      buttonText2: buttonTexts[1],
      buttonText3: buttonTexts[2],
      reply: "",
      btns,
    });

    const outTrackIdBase = encodeGateOutTrackId(payload.taskId);
    const errors: string[] = [];

    for (const userId of recipients) {
      const outTrackId =
        recipients.length === 1
          ? outTrackIdBase
          : encodeGateOutTrackId(payload.taskId, userId);
      const res = await fetch(`${cfg.openApiBase}/v1.0/card/instances/createAndDeliver`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify({
          userId,
          cardTemplateId: cfg.cardTemplateId,
          outTrackId,
          callbackType: "STREAM",
          userIdType: 1,
          openSpaceId: `dtv1.card//IM_ROBOT.${userId}`,
          cardData: { cardParamMap },
          imRobotOpenSpaceModel: {
            supportForward: false,
            lastMessageI18n: {
              ZH_CN: `闸门确认 · ${payload.title || payload.taskId}`,
            },
            searchSupport: {
              searchDesc: `gate ${payload.taskId}`,
            },
          },
          imRobotOpenDeliverModel: {
            spaceType: "IM_ROBOT",
            robotCode: cfg.appKey,
          },
        }),
      });
      const raw = await res.text();
      let body: {
        success?: boolean;
        result?: { deliverResults?: Array<{ success?: boolean; errorMsg?: string }> };
        code?: string;
        message?: string;
      } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        body = { message: raw.slice(0, 200) };
      }
      const deliverOk = body.result?.deliverResults?.every((d) => d.success) ?? false;
      if (!res.ok || body.success === false || !deliverOk) {
        const detail =
          body.result?.deliverResults?.map((d) => d.errorMsg).filter(Boolean).join("; ") ||
          body.message ||
          body.code ||
          raw.slice(0, 200);
        errors.push(`${userId}: HTTP ${res.status} ${detail}`);
      }
    }

    if (errors.length) {
      throw new Error(`DingTalk interactive card failed: ${errors.join(" | ")}`);
    }
  }

  private async sendCard(input: {
    title: string;
    markdown: string;
    buttons: { label: string; url: string }[];
  }): Promise<void> {
    this.requireConfigured();
    const markdown = this.withKeyword(input.markdown);
    const btns = input.buttons.slice(0, MAX_CARD_BUTTONS).map((b) => ({
      title: b.label.slice(0, 20) || "打开",
      url: this.link(b.url),
    }));

    if (this.cfg().webhook) {
      await this.sendWebhookActionCard({
        title: input.title,
        text: markdown,
        btns: btns.map((b) => ({ title: b.title, actionURL: b.url })),
      });
      return;
    }

    await this.sendWorkActionCard({
      title: input.title,
      markdown,
      btns: btns.map((b) => ({ title: b.title, action_url: b.url })),
    });
  }

  async sendGate(payload: GateNotifyPayload): Promise<void> {
    this.requireConfigured();

    // Prefer interactive card (Stream callback) when template is configured.
    if (this.usesInteractiveGate()) {
      await this.sendInteractiveGate(payload);
      return;
    }

    const issue = payload.issueCode ? ` · \`${payload.issueCode}\`` : "";
    const markdown = [
      `### agent-desk 闸门确认`,
      "",
      `**${payload.title || "Task"}**${issue}`,
      "",
      payload.gateHeading || "需要确认",
      "",
      "> 按钮会打开本机 Web；请保持 `oh web` 在运行。",
    ].join("\n");

    // Reserve one slot for “打开任务”.
    const choiceLimit = Math.min(MAX_CHOICE_BUTTONS, MAX_CARD_BUTTONS - 1);
    const buttons = payload.choices.slice(0, choiceLimit).map((c) => ({
      label: c.label || c.value,
      url: gateChoiceUrl(payload.webUrl, payload.taskId, c.value),
    }));
    buttons.push({ label: "打开任务", url: payload.webUrl });

    await this.sendCard({
      title: "agent-desk 闸门确认",
      markdown,
      buttons,
    });
  }

  async sendTaskUpdate(payload: TaskNotifyPayload): Promise<void> {
    const issue = payload.issueCode ? ` · \`${payload.issueCode}\`` : "";
    const markdown = [
      `### 任务 ${payload.status}`,
      "",
      `**${payload.title || "Task"}**${issue}`,
      "",
      payload.message || "",
    ].join("\n");

    await this.sendCard({
      title: `任务 ${payload.status}`,
      markdown,
      buttons: [{ label: "打开任务", url: payload.webUrl }],
    });
  }
}

export function registerDingTalkNotifyProvider(
  options?: DingTalkNotifyProviderOptions,
): DingTalkNotifyProvider {
  const provider = new DingTalkNotifyProvider(options);
  registerNotifyProvider(provider);
  return provider;
}

export {
  encodeGateOutTrackId,
  parseGateOutTrackId,
  replyFromCardCallback,
} from "./card-track.js";
export { createDingTalkGateResumeHandler } from "./resume-handler.js";
export {
  isDingTalkConfigured,
  resolveDingTalkConfig,
  setDingTalkSettingsSource,
  usesInteractiveGate,
  type ResolvedDingTalkConfig,
} from "./resolve.js";
export {
  parseDingTalkCardCallback,
  startDingTalkCardStream,
  type DingTalkCardCallbackEvent,
  type DingTalkCardCallbackResponse,
  type DingTalkStreamOptions,
} from "./stream.js";
