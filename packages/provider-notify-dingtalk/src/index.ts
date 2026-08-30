import { createHmac } from "node:crypto";
import {
  registerNotifyProvider,
  type GateNotifyPayload,
  type NotifyProvider,
  type TaskNotifyPayload,
} from "@agent-desk/provider-notify";

export interface DingTalkNotifyProviderOptions {
  /** Custom robot webhook URL (群机器人). */
  webhook?: string;
  /** Robot SEC secret for signed webhooks (加签). */
  secret?: string;
  /**
   * Custom keyword for robot security (自定义关键词).
   * Injected into ActionCard text so keyword-only robots accept the message.
   */
  keyword?: string;
  /** Enterprise app — alternative to webhook. */
  appKey?: string;
  appSecret?: string;
  agentId?: string;
  /** Comma-separated DingTalk userids for work notification. */
  userIds?: string;
  apiBase?: string;
  /**
   * Wrap http(s) links with dingtalk://…/page/link so PC client opens
   * system browser (better for localhost). Default true.
   */
  wrapLinks?: boolean;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const MAX_CHOICE_BUTTONS = 3;
/** DingTalk ActionCard independent buttons max out at 5. */
const MAX_CARD_BUTTONS = 5;

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

  private readonly webhook: string;
  private readonly secret: string;
  private readonly keyword: string;
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly agentId: string;
  private readonly userIds: string;
  private readonly apiBase: string;
  private readonly wrapLinks: boolean;
  private tokenCache: TokenCache | null = null;

  constructor(options: DingTalkNotifyProviderOptions = {}) {
    this.webhook = (options.webhook ?? process.env.AD_DINGTALK_WEBHOOK ?? "").trim();
    this.secret = (options.secret ?? process.env.AD_DINGTALK_SECRET ?? "").trim();
    this.keyword = (options.keyword ?? process.env.AD_DINGTALK_KEYWORD ?? "").trim();
    this.appKey = (options.appKey ?? process.env.AD_DINGTALK_APP_KEY ?? "").trim();
    this.appSecret = (options.appSecret ?? process.env.AD_DINGTALK_APP_SECRET ?? "").trim();
    this.agentId = (options.agentId ?? process.env.AD_DINGTALK_AGENT_ID ?? "").trim();
    this.userIds = (options.userIds ?? process.env.AD_DINGTALK_USER_IDS ?? "").trim();
    this.apiBase = (options.apiBase ?? process.env.AD_DINGTALK_API_BASE ?? "https://oapi.dingtalk.com")
      .trim()
      .replace(/\/$/, "");
    const wrapEnv = (process.env.AD_DINGTALK_WRAP_LINKS ?? "1").trim();
    this.wrapLinks =
      options.wrapLinks ?? !(wrapEnv === "0" || wrapEnv.toLowerCase() === "false");
  }

  /** Whether webhook or work-notify credentials are present. */
  isConfigured(): boolean {
    return Boolean(
      this.webhook || (this.appKey && this.appSecret && this.agentId && this.userIds),
    );
  }

  private requireConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        "DingTalk notify needs AD_DINGTALK_WEBHOOK, or app key/secret + AD_DINGTALK_AGENT_ID + AD_DINGTALK_USER_IDS",
      );
    }
  }

  private link(url: string): string {
    return dingtalkOpenUrl(url, this.wrapLinks);
  }

  /** Ensure keyword-security robots accept the message. */
  private withKeyword(markdown: string): string {
    if (!this.keyword) return markdown;
    if (markdown.includes(this.keyword)) return markdown;
    return `${this.keyword}\n\n${markdown}`;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }
    const qs = new URLSearchParams({
      appkey: this.appKey,
      appsecret: this.appSecret,
    });
    const res = await fetch(`${this.apiBase}/gettoken?${qs}`);
    const data = await readDingTalkJson(res);
    if (!res.ok || data.errcode !== 0 || !data.access_token) {
      throw new Error(
        `DingTalk token failed: HTTP ${res.status} errcode=${data.errcode} ${data.errmsg ?? data.raw.slice(0, 200)}`,
      );
    }
    this.tokenCache = {
      token: data.access_token,
      expiresAt: now + (data.expires_in ?? 7200) * 1000,
    };
    return data.access_token;
  }

  private async sendWebhookActionCard(card: {
    title: string;
    text: string;
    btns: { title: string; actionURL: string }[];
  }): Promise<void> {
    let url = this.webhook;
    if (this.secret) url = signedWebhookUrl(url, this.secret);
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
    const token = await this.accessToken();
    const res = await fetch(
      `${this.apiBase}/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          agent_id: Number(this.agentId) || this.agentId,
          userid_list: this.userIds,
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

    if (this.webhook) {
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
